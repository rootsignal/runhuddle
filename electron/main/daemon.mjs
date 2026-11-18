// This process owns PTYs. Electron windows are clients, never terminal owners.
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
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
  claudeHookState,
  codexTranscriptParser,
  copilotTranscriptParser,
  quote,
} from "./lifecycle.mjs";
import { prepareBrowserAgent } from "./browser-agent-config.mjs";
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
  const key = sessionKey(t);
  const previous = ledger.rows.get(key);
  const row = ledger.update(providers[t.agent], t.sessionID, {
    cwd: t.cwd,
    project: path.basename(t.cwd),
    ...patch,
  });
  if (previous !== row) history();
}
function claudeActivity(id, sessionID, args) {
  if (process.platform === "win32") return null;
  const file = path.join(directory, "activity", id + ".jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const script = fileURLToPath(new URL("./claude-activity.cjs", import.meta.url));
  const command = "ELECTRON_RUN_AS_NODE=1 " +
    [process.execPath, script, file, sessionID].map(quote).join(" ");
  const events = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Notification",
    "PreToolUse", "PostToolUse", "PostToolUseFailure", "Elicitation", "ElicitationResult", "Stop"];
  const hooks = Object.fromEntries(events.map((event) => [
    event,
    [{
      ...(event === "PreToolUse" ? { matcher: "AskUserQuestion" } : {}),
      hooks: [{ type: "command", command, timeout: 2 }],
    }],
  ]));
  args.push("--settings", JSON.stringify({ hooks }));
  return file;
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
  browserTools: !!t.browserAgent && !t.exited,
});
const broadcast = (message) => {
  for (const client of clients) send(client, message);
};
function stop() {
  if (stopping) return;
  stopping = true;
  for (const t of terminals.values()) {
    if (!t.exited) t.pty.kill();
    try { t.browserAgent?.cleanup(); } catch {}
  }
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
  const id = randomUUID();
  const argsForAgent = agent === "shell" ? [] : agentArguments(agent, identity.sessionID, !!resume);
  const activityFile = agent === "claude" ? claudeActivity(id, identity.sessionID, argsForAgent) : null;
  const baseline = resume && identity.transcript
    ? fs.statSync(identity.transcript, { throwIfNoEntry: false })
    : undefined;
  const browserAgent = agent === "shell" ? undefined : prepareBrowserAgent(agent, directory);
  if (browserAgent) argsForAgent.push(...browserAgent.flags);
  const launch =
    agent === "shell"
      ? {
          file:
            process.platform === "win32"
              ? process.env.COMSPEC || "cmd.exe"
              : os.userInfo().shell || "/bin/sh",
          args: process.platform === "win32" ? [] : ["-l"],
        }
      : shellLaunch(argsForAgent);
  const shell = launch.file,
    args = launch.args,
    env = terminalEnvironment();
  let child;
  try {
    child = pty.spawn(shell, args, { name: "xterm-256color", cwd, cols, rows, env });
  } catch (error) {
    browserAgent?.cleanup();
    throw error;
  }
  const t = {
    id,
    title: path.basename(cwd) || "Terminal",
    cwd,
    agent,
    pty: child,
    browserAgent,
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
      hasUserTitle: !!resume,
    });
    let hasHookActivity = false;
    const parse = agent === "codex" ? codexTranscriptParser() :
      agent === "copilot" ? copilotTranscriptParser() : undefined;
    const stopTranscript = watchTranscript(identity.transcript, agent, (patch) => {
      const row = ledger.rows.get(sessionKey(t));
      if (row?.terminalId === t.id) {
        const { promptTitle, ...changes } = patch;
        if (hasHookActivity) delete changes.state;
        if (promptTitle && !row.hasUserTitle) {
          changes.title = promptTitle;
          changes.hasUserTitle = true;
        }
        record(t, changes);
      }
    }, { baseline, parse });
    const stopActivity = watchTranscript(activityFile, agent, ({ state }) => {
      if (!state || ledger.rows.get(sessionKey(t))?.terminalId !== t.id) return;
      hasHookActivity = true;
      record(t, { state });
    }, {
      parse: (_agent, event) => {
        const state = claudeHookState(event);
        return state ? { state } : {};
      },
    });
    t.unwatch = () => {
      stopTranscript();
      stopActivity();
      if (activityFile) {
        try {
          fs.rmSync(activityFile, { force: true });
        } catch {}
      }
    };
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
    try { t.browserAgent?.cleanup(); } catch {}
    t.browserAgent = undefined;
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
    if (!clients.size && ![...terminals.values()].some((t) => !t.exited))
      idleTimer = setTimeout(stop, 10000);
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
          result: { protocol: PROTOCOL, pid: process.pid, browserTools: true },
        });
        return;
      }
      let result;
      const t = terminals.get(request.id);
      switch (request.method) {
        case "browser-key":
          result = !t?.exited ? t?.browserAgent?.key : null;
          break;
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
        case "sessions":
          result = ledger.list();
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
