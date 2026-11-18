import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function notesStore(file) {
  return {
    list() {
      if (!fs.existsSync(file)) return [];
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        return db
          .prepare("SELECT data FROM notes ORDER BY updated DESC")
          .all()
          .map(({ data }) => JSON.parse(data));
      } finally {
        db.close();
      }
    },
    save(draft, previous, source) {
      if (
        !draft ||
        typeof draft.title !== "string" ||
        typeof draft.text !== "string" ||
        !draft.title.trim() ||
        !draft.text.trim() ||
        draft.title.length > 120 ||
        draft.text.length > 100000
      ) {
        throw Error(
          "Enter a title up to 120 characters and note text up to 100,000 characters.",
        );
      }
      const project = previous?.project ?? source?.cwd ?? draft.project ?? "";
      if (
        typeof project !== "string" ||
        (!previous && project && !path.isAbsolute(project))
      )
        throw Error(
          "Choose a project folder or save the note without a project.",
        );
      const now = new Date().toISOString();
      const note = {
        ...previous,
        id: previous?.id ?? randomUUID(),
        project,
        sourceProvider: previous?.sourceProvider ?? source?.provider ?? "",
        sourceSessionID: previous?.sourceSessionID ?? source?.sessionID ?? "",
        sourceTitle: previous?.sourceTitle ?? source?.title,
        title: draft.title.trim(),
        text: draft.text,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };

      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const db = new DatabaseSync(file);
      try {
        if (process.platform !== "win32") fs.chmodSync(file, 0o600);
        db.exec(
          "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, updated TEXT NOT NULL, data TEXT NOT NULL)",
        );
        db.prepare(
          "INSERT OR REPLACE INTO notes (id, updated, data) VALUES (?, ?, ?)",
        ).run(note.id, now, JSON.stringify(note));
      } finally {
        db.close();
      }
      return note;
    },
  };
}
