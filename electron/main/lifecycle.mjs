import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
export const providers = {
  claude: "Claude",
  codex: "Codex",
  copilot: "Copilot",
};
export function validateID(id) {
  if (
    typeof id !== "string" ||
    !/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(
      id,
    )
  )
    throw Error("Invalid conversation ID");
  return id;
}
export function terminalEnvironment(source = process.env) {
  const env = {
    ...source,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "RunHuddle",
    CLICOLOR: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
  if (process.platform !== "win32") {
    env.LANG = process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8";
    env.LC_ALL = env.LANG;
  }
  return env;
}
export const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
export function shellLaunch(args) {
  return process.platform === "win32"
    ? {
        file: process.env.COMSPEC || "cmd.exe",
        args: [
          "/d",
          "/s",
          "/c",
          args.map((x) => '"' + x.replaceAll('"', "") + '"').join(" "),
        ],
      }
    : {
        file: os.userInfo().shell || "/bin/sh",
        args: ["-lic", "exec " + args.map(quote).join(" ")],
      };
}
export function agentArguments(agent, id, resume = false) {
  validateID(id);
  if (agent === "codex") return ["codex", "resume", "--no-daemon", id];
  if (agent === "claude")
    return ["claude", resume ? "--resume" : "--session-id", id];
  if (agent === "copilot") return ["copilot", "--session-id", id];
  throw Error("Unknown agent");
}
// Allocate the real Codex thread before launching its terminal. No turn is sent.
// The owned CLI runs without a detached provider daemon, so ending its PTY ends its work.
export function allocateCodex(cwd) {
  return new Promise((resolve, reject) => {
    const launch = shellLaunch(["codex", "app-server", "--stdio"]);
    const child = spawn(launch.file, launch.args, {
      cwd,
      env: terminalEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let allocated;
    let buffer = "",
      done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.end();
      if (error) {
        child.kill();
        reject(error);
      } else {
        const kill = setTimeout(() => child.kill(), 2000);
        kill.unref();
        child.once("exit", () => {
          clearTimeout(kill);
          resolve(result);
        });
      }
    };
    const timer = setTimeout(
      () =>
        finish(
          Error(
            "Codex did not initialize. Check its CLI installation and login.",
          ),
        ),
      20000,
    );
    child.on("error", (e) => finish(e));
    child.on("exit", () =>
      finish(
        Error(
          "Codex exited before creating a conversation. Check its CLI installation and login.",
        ),
      ),
    );
    child.stderr.resume();
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024)
        return finish(Error("Codex initialization response too large"));
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.id === 1) {
          if (m.error) return finish(Error(m.error.message));
          child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
          child.stdin.write(
            JSON.stringify({
              id: 2,
              method: "thread/start",
              params: { cwd, ephemeral: false },
            }) + "\n",
          );
        }
        if (m.id === 3) {
          if (m.error) return finish(Error(m.error.message));
          finish(null, allocated);
        }
        if (m.id === 2) {
          if (m.error) return finish(Error(m.error.message));
          try {
            validateID(m.result.thread.id);
            allocated = {
              sessionID: m.result.thread.id,
              transcript: m.result.thread.path || null,
            };
            child.stdin.write(
              JSON.stringify({
                id: 3,
                method: "thread/name/set",
                params: {
                  threadId: allocated.sessionID,
                  name: "Codex session",
                },
              }) + "\n",
            );
          } catch (e) {
            finish(e);
          }
        }
      }
    });
    child.stdin.on("error", (e) => finish(e));
    child.stdin.write(
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "runhuddle_preview", version: "0.1.0" } },
      }) + "\n",
    );
  });
}
export function transcriptPath(agent, id, cwd) {
  validateID(id);
  if (agent === "claude")
    return path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
      "projects",
      cwd.replace(/[^a-zA-Z0-9]/g, "-"),
      id + ".jsonl",
    );
  if (agent === "copilot")
    return path.join(
      process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"),
      "session-state",
      id,
      "events.jsonl",
    );
  if (agent === "codex") {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    for (const name of fs.existsSync(home)
      ? fs
          .readdirSync(home)
          .filter((n) => /^state_\d+\.sqlite$/.test(n))
          .sort()
          .reverse()
      : []) {
      let db;
      try {
        db = new DatabaseSync(path.join(home, name), { readOnly: true });
        const row = db
          .prepare("SELECT rollout_path FROM threads WHERE id=?")
          .get(id);
        if (row) return row.rollout_path;
      } catch {
      } finally {
        db?.close();
      }
    }
  }
  return null;
}
export async function prepareSession(agent, cwd, resume) {
  if (resume) {
    validateID(resume);
    return {
      sessionID: resume,
      transcript: transcriptPath(agent, resume, cwd),
    };
  }
  if (agent === "codex") return allocateCodex(cwd);
  const sessionID = randomUUID();
  return { sessionID, transcript: transcriptPath(agent, sessionID, cwd) };
}
export function transcriptEvent(agent, event) {
  let state, preview, title;
  const p = event.payload || event.data || {};
  if (agent === "codex") {
    if (event.type === "event_msg") {
      state = {
        task_started: "working",
        task_complete: "idle",
        turn_aborted: "idle",
        user_message: "working",
      }[p.type];
      if (p.type === "user_message") preview = p.message;
      if (p.type === "agent_message") preview = p.message;
    }
  }
  if (agent === "claude" && !event.isSidechain) {
    if (event.type === "user" && typeof event.message?.content === "string") {
      state = "working";
      preview = event.message.content;
    }
    if (event.type === "assistant") {
      const m = event.message || {};
      state =
        m.stop_reason === "end_turn"
          ? "idle"
          : m.stop_reason === "tool_use"
            ? "working"
            : undefined;
      preview = Array.isArray(m.content)
        ? m.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n")
        : undefined;
    }
  }
  if (agent === "copilot") {
    state = {
      "user.message": "working",
      "assistant.turn_start": "working",
      "assistant.turn_end": "idle",
      "session.error": "disconnected",
    }[event.type];
    if (["user.message", "assistant.message"].includes(event.type))
      preview = p.content;
    if (event.type === "session.title_changed") title = p.title;
  }
  const patch = {};
  if (
    (agent === "codex" &&
      event.type === "event_msg" &&
      p.type === "user_message") ||
    (agent === "claude" &&
      event.type === "user" &&
      typeof event.message?.content === "string") ||
    (agent === "copilot" && event.type === "user.message")
  ) {
    if (typeof preview === "string" && preview.trim())
      patch.promptTitle = preview.trim().split("\n")[0].slice(0, 120);
  }
  if (state) patch.state = state;
  if (typeof preview === "string" && preview.trim())
    patch.preview = preview.slice(0, 4000);
  if (typeof title === "string" && title.trim())
    patch.title = title.slice(0, 120);
  return patch;
}
export class SessionLedger {
  constructor(directory) {
    this.file = path.join(directory, "sessions.json");
    this.rows = new Map();
    if (fs.existsSync(this.file)) {
      const rows = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!Array.isArray(rows)) throw Error("Invalid preview session history");
      for (const r of rows)
        this.rows.set(r.provider + ":" + r.sessionID, {
          ...r,
          terminalId: undefined,
          state: r.state === "archived" ? "archived" : "saved",
        });
    }
  }
  list() {
    return [...this.rows.values()];
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.list()), {
      mode: 0o600,
    });
    fs.renameSync(this.file + ".tmp", this.file);
  }
  update(provider, id, patch) {
    const key = provider + ":" + validateID(id);
    const old = this.rows.get(key) || {
      provider,
      sessionID: id,
      preview: "",
      title: provider + " session",
      state: "disconnected",
    };
    const next = { ...old, ...patch };
    if (JSON.stringify(old) === JSON.stringify(next)) return old;
    next.updated = Date.now() / 1000;
    this.rows.set(key, next);
    this.save();
    return next;
  }
}
// Watch only this conversation's containing directory; no whole-history polling.
export function watchTranscript(file, agent, update) {
  if (!file) return () => {};
  let watcher,
    timer,
    offset = 0,
    pending = "",
    closed = false;
  function read() {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) return;
      if (stat.size < offset) {
        offset = 0;
        pending = "";
      }
      if (stat.size - offset > 512 * 1024) {
        offset = stat.size - 512 * 1024;
        pending = "";
      }
      const n = Math.min(stat.size - offset, 512 * 1024);
      if (!n) return;
      const fd = fs.openSync(file, "r");
      const bytes = Buffer.alloc(n);
      try {
        fs.readSync(fd, bytes, 0, n, offset);
      } finally {
        fs.closeSync(fd);
      }
      offset += n;
      pending += bytes.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop();
      let patch = {};
      for (const line of lines) {
        try {
          Object.assign(patch, transcriptEvent(agent, JSON.parse(line)));
        } catch {}
      }
      if (Object.keys(patch).length) update(patch);
    } catch {}
  }
  function attach() {
    if (closed) return;
    watcher?.close();
    let dir = path.dirname(file);
    while (!fs.existsSync(dir)) {
      const parent = path.dirname(dir);
      if (parent === dir) return;
      dir = parent;
    }
    try {
      watcher = fs.watch(dir, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          read();
          if (dir !== path.dirname(file)) attach();
        }, 150);
      });
      watcher.on("error", () => {});
    } catch {}
    read();
  }
  attach();
  return () => {
    if (closed) return;
    closed = true;
    read();
    clearTimeout(timer);
    watcher?.close();
  };
}
export function mergeSessions(nativeRows, ownedRows) {
  const rows = new Map(
    nativeRows.map((r) => [r.provider.toLowerCase() + ":" + r.sessionID, r]),
  );
  for (const owned of ownedRows) {
    const k = owned.provider.toLowerCase() + ":" + owned.sessionID;
    const native = rows.get(k);
    rows.set(k, {
      ...native,
      ...owned,
      title:
        owned.title === owned.provider + " session" && native?.title
          ? native.title
          : owned.title,
      preview: owned.preview || native?.preview || "",
      ...(owned.terminalId &&
      native?.updated > owned.updated &&
      ["working", "idle", "needsInput"].includes(native.state)
        ? {
            state: native.state,
            preview: native.preview || owned.preview,
            title: native.title || owned.title,
          }
        : {}),
    });
  }
  return [...rows.values()];
}
