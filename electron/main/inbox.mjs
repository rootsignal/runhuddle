import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const key = (row) => row.provider + ":" + row.sessionID;
const limit = 100;

export function createInbox(file, publish) {
  let completions = [];
  let waiting = [];
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(saved)) {
      completions = saved
        .filter(
          (entry) =>
            entry?.kind === "completion" &&
            typeof entry.id === "string" &&
            typeof entry.provider === "string" &&
            typeof entry.sessionID === "string" &&
            typeof entry.body === "string" &&
            Number.isFinite(entry.createdAt),
        )
        .slice(0, limit);
    }
  } catch {}

  const list = () => [...waiting, ...completions];

  function save(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file + ".tmp", JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
    completions = next;
    publish(list());
  }

  return {
    list,
    sync(rows) {
      const previous = new Map(waiting.map((entry) => [entry.id, entry]));
      const next = rows
        .filter(
          (row) =>
            row.terminalId && !row.simulated && row.state === "needsInput",
        )
        .map((row) => {
          const id = "input:" + key(row);
          return {
            id,
            kind: "input",
            provider: row.provider,
            sessionID: row.sessionID,
            body: row.title || "Open session",
            createdAt:
              previous.get(id)?.createdAt ??
              (row.updated ? row.updated * 1000 : Date.now()),
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
      if (
        next.length === waiting.length &&
        next.every(
          (entry, i) =>
            entry.id === waiting[i].id && entry.body === waiting[i].body,
        )
      )
        return;
      waiting = next;
      publish(list());
    },
    complete(alert) {
      const entry = {
        id: randomUUID(),
        kind: "completion",
        provider: alert.provider,
        sessionID: alert.sessionID,
        body: alert.body,
        createdAt: Date.now(),
      };
      save(
        [entry, ...completions.filter((old) => key(old) !== key(entry))].slice(
          0,
          limit,
        ),
      );
      return entry.id;
    },
    dismiss(id) {
      if (completions.some((entry) => entry.id === id))
        save(completions.filter((entry) => entry.id !== id));
    },
  };
}
