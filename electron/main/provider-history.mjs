import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parentPort } from "node:worker_threads";
import { providers, validateID } from "./lifecycle.mjs";
import { historyMessage } from "./history.mjs";

function entries(directory) {
  try { return fs.readdirSync(directory, { withFileTypes: true }); }
  catch { return []; }
}

function sessionRow(agent, id, cwd, title, preview, updated, archived = false) {
  try { validateID(id); } catch { return; }
  if (typeof cwd !== "string" || !path.isAbsolute(cwd) || !Number.isFinite(updated)) return;
  const provider = providers[agent];
  return {
    provider, sessionID: id, cwd, project: path.basename(cwd) || cwd,
    title: (typeof title === "string" && title.trim().split(/\r?\n/, 1)[0].slice(0, 120)) || provider + " session",
    preview: typeof preview === "string" ? preview.trim().slice(0, 280) : "",
    updated, state: archived ? "archived" : "saved",
  };
}

function codexRows(home) {
  const databases = entries(home).filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/.test(entry.name))
    .sort((a, b) => Number(b.name.match(/\d+/)[0]) - Number(a.name.match(/\d+/)[0]));
  for (const { name } of databases) {
    let database;
    try {
      database = new DatabaseSync(path.join(home, name), { readOnly: true });
      const columns = new Set(database.prepare("PRAGMA table_info(threads)").all().map((column) => column.name));
      const optional = ["archived", "first_user_message", "has_user_event", "preview"]
        .filter((column) => columns.has(column));
      const rows = database.prepare(
        "SELECT " + ["id", "cwd", "title", "updated_at", ...optional].join(", ") + " FROM threads",
      ).all();
      return rows.filter((row) => row.has_user_event !== 0 || row.first_user_message || row.preview)
        .map((row) => sessionRow("codex", row.id, row.cwd, row.title || row.first_user_message,
          row.preview || row.first_user_message, row.updated_at, Boolean(row.archived))).filter(Boolean);
    } catch {} finally { database?.close(); }
  }
  return [];
}

function transcriptRow(agent, file, id, cache) {
  let handle;
  try {
    validateID(id);
    if (!fs.lstatSync(file).isFile()) return;
    handle = fs.openSync(file, "r");
    const stats = fs.fstatSync(handle);
    if (!stats.isFile()) return;
    const cached = cache.get(file);
    if (cached?.modified === stats.mtimeMs && cached.size === stats.size) return cached.row;
    const bytes = Buffer.alloc(Math.min(stats.size, 128 * 1024));
    fs.readSync(handle, bytes, 0, bytes.length, 0);
    let cwd, firstPrompt, title;
    for (const line of bytes.toString("utf8").split("\n")) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (agent === "claude" && !event?.isSidechain) {
        cwd ??= event?.cwd;
        if (event?.type === "custom-title") title = event.customTitle;
      } else if (agent === "copilot") {
        if (event?.type === "session.start") cwd ??= event.data?.context?.cwd;
        if (event?.type === "session.title_changed") title = event.data?.title;
      }
      if (!firstPrompt) {
        const message = historyMessage(agent, line);
        if (message?.role === "user" && !/^<(command-|local-command-)/.test(message.text.trim())) firstPrompt = message.text;
      }
    }
    const row = firstPrompt || title
      ? sessionRow(agent, id, cwd, typeof title === "string" ? title : firstPrompt, firstPrompt, stats.mtimeMs / 1000)
      : undefined;
    cache.set(file, { modified: stats.mtimeMs, size: stats.size, row });
    return row;
  } catch {} finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

export function discoverProviderHistory(env = process.env, cache = new Map()) {
  const claude = path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
  const copilot = path.join(env.COPILOT_HOME || path.join(os.homedir(), ".copilot"), "session-state");
  const rows = codexRows(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const scanned = new Set();
  const collect = (agent, file, id) => {
    scanned.add(file);
    const row = transcriptRow(agent, file, id, cache);
    if (row) rows.push(row);
  };
  for (const project of entries(claude).filter((entry) => entry.isDirectory())) {
    const directory = path.join(claude, project.name);
    for (const file of entries(directory).filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))) {
      collect("claude", path.join(directory, file.name), file.name.slice(0, -6));
    }
  }
  for (const session of entries(copilot).filter((entry) => entry.isDirectory())) {
    collect("copilot", path.join(copilot, session.name, "events.jsonl"), session.name);
  }
  for (const file of cache.keys()) if (!scanned.has(file)) cache.delete(file);
  return rows.sort((a, b) => b.updated - a.updated);
}

if (parentPort) {
  const cache = new Map();
  parentPort.on("message", () => {
    try { parentPort.postMessage({ rows: discoverProviderHistory(process.env, cache) }); }
    catch { parentPort.postMessage({}); }
  });
}
