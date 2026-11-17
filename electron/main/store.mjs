import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
export function readStore(filename) {
  const result = { sessions: [], notes: [], pinned: [], readAt: Date.now() };
  if (!fs.existsSync(filename)) return result;
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=2000; BEGIN;");
    const query = db.prepare("SELECT value FROM records WHERE key=?");
    for (const [key, field] of [
      ["sessions", "sessions"],
      ["savedWorkLibrary", "notes"],
      ["pinnedSessions", "pinned"],
    ]) {
      const row = query.get(key);
      if (row) {
        const value = JSON.parse(
          typeof row.value === "string"
            ? row.value
            : Buffer.from(row.value).toString(),
        );
        if (!Array.isArray(value))
          throw new Error(`Unexpected native store format: ${key}`);
        result[field] = value;
      }
    }
    return result;
  } finally {
    db.close();
  }
}
