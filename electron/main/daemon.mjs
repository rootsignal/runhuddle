// This process owns PTYs. Electron windows are clients, never terminal owners.
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, timingSafeEqual } from "node:crypto";
import pty from "node-pty";
import { address, frames, send, dimensions, PROTOCOL } from "./protocol.mjs";
const directory = process.argv[2];
const token = fs.readFileSync(path.join(directory, "service.token"), "utf8");
const endpoint = address(directory);
const terminals = new Map();
const clients = new Set();
let stopping = false;
let idleTimer;
const describe = (t) => ({
  id: t.id,
  title: t.title,
  cwd: t.cwd,
  agent: t.agent,
  exited: t.exited,
  exitCode: t.exitCode,
});
const broadcast = (message) => {
  for (const client of clients) send(client, message);
};
function stop() {
  if (stopping) return;
  stopping = true;
  for (const t of terminals.values()) if (!t.exited) t.pty.kill();
  for (const c of clients) c.end();
  server.close(() => {
    if (process.platform !== "win32") {
      try {
        fs.unlinkSync(endpoint);
      } catch {}
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
}
function create({ cwd, agent = "shell", cols = 100, rows = 30 }) {
  dimensions(cols, rows);
  if (
    typeof cwd !== "string" ||
    !path.isAbsolute(cwd) ||
    !fs.statSync(cwd).isDirectory()
  )
    throw new Error("Choose an existing folder");
  if (!["shell", "claude", "codex", "copilot"].includes(agent))
    throw new Error("Unknown agent");
  const windows = process.platform === "win32";
  const shell = windows
    ? process.env.COMSPEC || "cmd.exe"
    : os.userInfo().shell || "/bin/sh";
  const args = windows
    ? agent === "shell"
      ? []
      : ["/d", "/s", "/c", agent]
    : agent === "shell"
      ? ["-l"]
      : ["-lic", "exec " + agent];
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };
  // Never leak the helper's Electron mode into shells or applications they launch.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  if (!windows) {
    env.LANG = process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8";
    env.LC_ALL = env.LANG;
  }
  const child = pty.spawn(shell, args, {
    name: "xterm-256color",
    cwd,
    cols,
    rows,
    env,
  });
  const t = {
    id: randomUUID(),
    title: path.basename(cwd) || "Terminal",
    cwd,
    agent,
    pty: child,
    exited: false,
    history: "",
    pending: "",
    sequence: 0,
  };
  terminals.set(t.id, t);
  child.onData((data) => {
    t.sequence++;
    t.history = (t.history + data).slice(-512 * 1024);
    t.pending += data;
    if (!t.flush)
      t.flush = setTimeout(() => {
        t.flush = undefined;
        broadcast({
          event: "output",
          id: t.id,
          data: t.pending,
          sequence: t.sequence,
        });
        t.pending = "";
      }, 16);
  });
  child.onExit(({ exitCode }) => {
    t.exited = true;
    t.exitCode = exitCode;
    broadcast({
      event: "terminals",
      terminals: [...terminals.values()].map(describe),
    });
  });
  broadcast({
    event: "terminals",
    terminals: [...terminals.values()].map(describe),
  });
  return describe(t);
}
const server = net.createServer((socket) => {
  let authenticated = false;
  const deadline = setTimeout(() => socket.destroy(), 3000);
  socket.on("error", () => {});
  socket.on("close", () => {
    clearTimeout(deadline);
    clients.delete(socket);
    if (!clients.size && !terminals.size) idleTimer = setTimeout(stop, 10000);
  });
  frames(socket, (request) => {
    try {
      if (!authenticated) {
        const supplied = Buffer.from(
          typeof request.token === "string" ? request.token : "",
        );
        const expected = Buffer.from(token);
        if (
          request.method !== "hello" ||
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        )
          return socket.destroy();
        authenticated = true;
        clearTimeout(idleTimer);
        clearTimeout(deadline);
        clients.add(socket);
        send(socket, {
          request: request.request,
          result: { protocol: PROTOCOL },
        });
        return;
      }
      let result;
      const t = terminals.get(request.id);
      switch (request.method) {
        case "list":
          result = [...terminals.values()].map(describe);
          break;
        case "create":
          result = create(request);
          break;
        case "replay":
          if (!t) throw new Error("Terminal no longer exists");
          clearTimeout(t.flush);
          t.flush = undefined;
          if (t.pending) {
            broadcast({
              event: "output",
              id: t.id,
              data: t.pending,
              sequence: t.sequence,
            });
            t.pending = "";
          }
          result = { data: t.history, sequence: t.sequence };
          break;
        case "write":
          if (!t || t.exited) throw new Error("Terminal is closed");
          if (
            typeof request.data !== "string" ||
            request.data.length > 1024 * 1024
          )
            throw new Error("Invalid input");
          t.pty.write(request.data);
          break;
        case "resize":
          dimensions(request.cols, request.rows);
          if (t && !t.exited) t.pty.resize(request.cols, request.rows);
          break;
        case "close":
          if (!t) throw new Error("Terminal no longer exists");
          if (!t.exited) t.pty.kill();
          clearTimeout(t.flush);
          terminals.delete(t.id);
          broadcast({
            event: "terminals",
            terminals: [...terminals.values()].map(describe),
          });
          break;
        case "shutdown":
          send(socket, { request: request.request, result: true });
          stop();
          return;
        default:
          throw new Error("Unknown terminal operation");
      }
      send(socket, { request: request.request, result: result ?? null });
    } catch (error) {
      send(socket, { request: request.request, error: error.message });
    }
  });
});
server.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
server.listen(endpoint, () => {
  if (process.platform !== "win32") fs.chmodSync(endpoint, 0o600);
});
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
