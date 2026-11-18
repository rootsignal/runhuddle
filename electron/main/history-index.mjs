import { closeSync, mkdirSync, openSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { historyMessage } from "./history.mjs";
import {
  fingerprint, historyMatch, resultLimit, transcriptLines,
} from "./history-search.mjs";
import { transcriptPath } from "./lifecycle.mjs";

export const historyKey = ({ provider, sessionID }) => provider + ":" + sessionID;
const normalize = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();

async function checkpoint(file, cursor) {
  const bytes = Buffer.alloc(Math.min(cursor, 4096));
  if (!bytes.length) return "";
  const { bytesRead } = await file.read(bytes, 0, bytes.length, cursor - bytes.length);
  return fingerprint(bytes.subarray(0, bytesRead));
}

export class HistoryIndex {
  constructor(database) {
    mkdirSync(path.dirname(database), { recursive: true, mode: 0o700 });
    closeSync(openSync(database, "a", 0o600));
    this.db = new DatabaseSync(database);
    this.db.function("normalize", { deterministic: true }, normalize);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS source (
        key TEXT PRIMARY KEY, identity TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0,
        checkpoint TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT -1,
        modified REAL NOT NULL DEFAULT -1
      );
      CREATE TABLE IF NOT EXISTS message (
        id INTEGER PRIMARY KEY, source TEXT NOT NULL REFERENCES source(key) ON DELETE CASCADE,
        offset INTEGER NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS message_source ON message(source, offset);
      CREATE VIRTUAL TABLE IF NOT EXISTS terms USING fts5(
        body, content='message', content_rowid='id', tokenize='trigram case_sensitive 1', detail=none
      );
      INSERT INTO terms(terms, rank) VALUES ('secure-delete', 1);
      CREATE TRIGGER IF NOT EXISTS index_message AFTER INSERT ON message BEGIN
        INSERT INTO terms(rowid, body) VALUES (new.id, normalize(new.body));
      END;
      CREATE TRIGGER IF NOT EXISTS unindex_message AFTER DELETE ON message BEGIN
        INSERT INTO terms(terms, rowid, body) VALUES ('delete', old.id, normalize(old.body));
      END;
      CREATE TEMP TABLE eligible (source TEXT UNIQUE, priority INTEGER PRIMARY KEY);
    `);
    this.statements = {
      source: this.db.prepare("SELECT * FROM source WHERE key = ?"),
      sources: this.db.prepare("SELECT key FROM source"),
      create: this.db.prepare("INSERT INTO source(key, identity) VALUES (?, ?)"),
      remove: this.db.prepare("DELETE FROM source WHERE key = ?"),
      clearTail: this.db.prepare("DELETE FROM message WHERE source = ? AND offset >= ?"),
      insert: this.db.prepare("INSERT INTO message(source, offset, hash, body) VALUES (?, ?, ?, ?)"),
      save: this.db.prepare("UPDATE source SET cursor = ?, checkpoint = ?, size = ?, modified = ? WHERE key = ?"),
      eligible: this.db.prepare("INSERT OR IGNORE INTO eligible VALUES (?, ?)"),
    };
  }

  close() {
    this.db.close();
  }

  transaction(write) {
    this.db.exec("BEGIN");
    try {
      write();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  prune(keys) {
    const { sources, remove } = this.statements;
    this.transaction(() => {
      for (const { key } of sources.all()) {
        if (!keys.has(key)) remove.run(key);
      }
    });
  }

  // Return bytes scanned so incremental reads can be measured.
  async sync(session) {
    const key = historyKey(session);
    const agent = session.provider.toLowerCase();
    const { source, create, remove, clearTail, insert, save } = this.statements;
    let file;
    try {
      const transcript = transcriptPath(agent, session.sessionID, session.cwd);
      if (transcript) file = await open(transcript, "r");
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    if (!file) {
      remove.run(key);
      return 0;
    }

    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw Error("Transcript is not a file");
      const { dev, ino, birthtimeMs, size, mtimeMs, ctimeMs } = stat;
      const identity = JSON.stringify([dev, ino, birthtimeMs]);
      const modified = Math.max(mtimeMs, ctimeMs);
      const previous = source.get(key);
      if (previous?.identity === identity && previous.size === size &&
          previous.modified === modified) return 0;

      const append = previous?.identity === identity &&
        size > previous.size && size >= previous.cursor &&
        previous.checkpoint === await checkpoint(file, previous.cursor);
      const start = append ? previous.cursor : 0;
      this.transaction(() => {
        if (append) clearTail.run(key, start);
        else {
          remove.run(key);
          create.run(key, identity);
        }
      });
      let cursor = start;
      let rows = [];
      let bytes = 0;
      const flush = async (complete = false) => {
        const signature = await checkpoint(file, cursor);
        this.transaction(() => {
          for (const row of rows) insert.run(key, ...row);
          save.run(cursor, signature, complete ? size : -1, complete ? modified : -1, key);
        });
        rows = [];
        bytes = 0;
      };

      if (start < size) {
        for await (const { offset, nextOffset, line } of transcriptLines(file, start, size - 1, true)) {
          cursor = nextOffset;
          const message = line && historyMessage(agent, line);
          if (message) {
            rows.push([offset, fingerprint(line), message.text]);
            bytes += Buffer.byteLength(message.text);
          }
          if (nextOffset > offset && (bytes >= 1024 * 1024 || rows.length >= 512))
            await flush();
        }
      }
      await flush(true);
      return size - start;
    } finally {
      await file.close();
    }
  }

  search(sessions, query) {
    const words = [...new Set(normalize(query).split(" "))];
    // The compact trigram index finds candidates. Verify full substrings
    // against the message because the index omits token positions.
    const trigrams = new Set();
    for (const word of words) {
      const chars = [...word];
      for (let i = 0; i + 2 < chars.length; i++)
        trigrams.add(chars.slice(i, i + 3).join(""));
    }
    const match = [...trigrams].map((gram) => '"' + gram.replaceAll('"', '""') + '"').join(" AND ");
    this.db.exec("DELETE FROM eligible");
    this.transaction(() => {
      sessions.forEach((session, priority) =>
        this.statements.eligible.run(historyKey(session), priority),
      );
    });
    const conditions = words.map(() => "instr(normalize(m.body), ?) > 0");
    const rows = this.db.prepare(`
      WITH matches AS MATERIALIZED (
        SELECT e.priority, (
          SELECT m.id FROM message m
          WHERE m.source = e.source
            ${match ? "AND m.id IN (SELECT rowid FROM terms WHERE terms MATCH ?)" : ""}
            AND ${conditions.join(" AND ")}
          ORDER BY m.offset
          LIMIT 1
        ) AS id
        FROM eligible e
        WHERE id IS NOT NULL
        ORDER BY e.priority
        LIMIT ${resultLimit + 1}
      )
      SELECT m.offset, m.hash, m.body, matches.priority
      FROM matches JOIN message m ON m.id = matches.id
      ORDER BY matches.priority
    `).all(...(match ? [match] : []), ...words);
    return {
      results: rows.slice(0, resultLimit).map((row) =>
        historyMatch(sessions[row.priority], { text: row.body }, words, row.offset, row.hash),
      ).filter(Boolean),
      incomplete: rows.length > resultLimit,
    };
  }
}
