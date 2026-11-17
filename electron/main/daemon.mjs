// This process owns PTYs. Electron windows are clients, never terminal owners.
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, timingSafeEqual } from "node:crypto";
import pty from "node-pty";
import {
  SessionLedger,
  providers,
  prepareSession,
  agentArguments,
  shellLaunch,
  terminalEnvironment,
  watchTranscript,
  validateID,
} from "./lifecycle.mjs";
import { address, frames, send, dimensions, PROTOCOL } from "./protocol.mjs";
const directory = process.argv[2];
const token = fs.readFileSync(path.join(directory, "service.token"), "utf8");
const endpoint = address(directory);
const terminals = new Map();
const ledger = new SessionLedger(directory);
const sessionKey = (t) => providers[t.agent] + ":" + t.sessionID;
const history = () => broadcast({ event: "history", sessions: ledger.list() });
function record(t, patch) {
  if (!t.sessionID) return;
  ledger.update(providers[t.agent], t.sessionID, {
    cwd: t.cwd,
    project: path.basename(t.cwd),
    ...patch,
  });
  history();
}
const clients = new Set();
let creationQueue = Promise.resolve();
let stopping = false;
let idleTimer;
const describe = (t) => ({
  id: t.id,
  title: t.title,
  cwd: t.cwd,
  agent: t.agent,
  exited: t.exited,
  exitCode: t.exitCode,
  sessionID: t.sessionID,
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
async function create({ cwd, agent = "shell", cols = 100, rows = 30, resume }) {
  dimensions(cols, rows);
  if (
    typeof cwd !== "string" ||
    !path.isAbsolute(cwd) ||
    !fs.statSync(cwd).isDirectory()
  )
    throw new Error("Choose an existing folder");
  if (!["shell", "claude", "codex", "copilot"].includes(agent))
    throw new Error("Unknown agent");
  if (resume) {
    validateID(resume);
    const existing = [...terminals.values()].find(
      (t) => t.agent === agent && t.sessionID === resume && !t.exited,
    );
    if (existing) return describe(existing);
  }
  const identity =
    agent === "shell" ? {} : await prepareSession(agent, cwd, resume);
  const launch =
    agent === "shell"
      ? {
          file:
            process.platform === "win32"
              ? process.env.COMSPEC || "cmd.exe"
              : os.userInfo().shell || "/bin/sh",
          args: process.platform === "win32" ? [] : ["-l"],
        }
      : shellLaunch(agentArguments(agent, identity.sessionID, !!resume));
  const shell = launch.file,
    args = launch.args,
    env = terminalEnvironment();
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
    sessionID: identity.sessionID,
    exited: false,
    history: "",
    pending: "",
    sequence: 0,
  };
  terminals.set(t.id, t);
  if (t.sessionID) {
    record(t, {
      terminalId: t.id,
      state: "disconnected",
      imported: false,
      hasUserTitle: !!resume,
    });
    t.unwatch = watchTranscript(identity.transcript, agent, (patch) => {
      const row = ledger.rows.get(sessionKey(t));
      if (row?.terminalId === t.id) {
        const { promptTitle, ...changes } = patch;
        if (promptTitle && !row.hasUserTitle) {
          changes.title = promptTitle;
          changes.hasUserTitle = true;
        }
        record(t, changes);
      }
    });
  }
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
    t.unwatch?.();
    if (t.sessionID && ledger.release(providers[t.agent], t.sessionID, t.id))
      history();
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
  frames(socket, async (request) => {
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
          result: { protocol: PROTOCOL, pid: process.pid },
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
          {
            const pending = creationQueue.then(() => create(request));
            creationQueue = pending.catch(() => {});
            result = await pending;
          }
          break;
        case "title":
          if (
            t?.sessionID &&
            typeof request.title === "string" &&
            !(
              ledger.rows.get(sessionKey(t))?.hasUserTitle &&
              /^(Codex|Claude|Copilot)( session| Code)?(?:[ |·-].*)?$/i.test(
                request.title,
              )
            ) &&
            request.title.trim()
          )
            record(t, { title: request.title.trim().slice(0, 120) });
          break;
        case "adopt": {
          const row = request.session;
          if (
            !row ||
            !Object.values(providers).includes(row.provider) ||
            typeof row.cwd !== "string" ||
            !path.isAbsolute(row.cwd)
          )
            throw Error("Invalid session");
          validateID(row.sessionID);
          result = ledger.update(row.provider, row.sessionID, {
            cwd: row.cwd,
            project: path.basename(row.cwd),
            title: String(row.title || row.provider + " session").slice(0, 120),
            preview: String(row.preview || "").slice(0, 4000),
            state: row.state === "archived" ? "archived" : "saved",
            imported: true,
          });
          history();
          break;
        }
        case "sessions":
          result = ledger.list();
          break;
        case "archive": {
          const row = ledger.rows.get(
            request.provider + ":" + validateID(request.sessionID),
          );
          if (!row) throw Error("Session not found");
          if (
            [...terminals.values()].some(
              (t) =>
                sessionKey(t) === request.provider + ":" + request.sessionID &&
                !t.exited,
            )
          )
            throw Error("End the session before archiving it");
          ledger.update(request.provider, request.sessionID, {
            state: request.archived ? "archived" : "saved",
          });
          history();
          break;
        }
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
          t.unwatch?.();
          if (!t.exited) t.pty.kill();
          if (
            t.sessionID &&
            ledger.release(providers[t.agent], t.sessionID, t.id)
          )
            history();
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
