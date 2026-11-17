import fs from "node:fs";
// Retain metadata only: losing a PTY must not silently erase the user's layout.
export class TerminalInventory {
  constructor(file) {
    this.file = file;
    this.rows = [];
    try {
      const rows = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(rows))
        this.rows = rows.filter(
          (t) => typeof t.id === "string" && typeof t.cwd === "string",
        );
    } catch {}
  }
  reconcile(live) {
    const current = new Map(live.map((t) => [t.id, t]));
    this.rows = this.rows.map(
      (t) => current.get(t.id) || { ...t, exited: true, unavailable: true },
    );
    const known = new Set(this.rows.map((t) => t.id));
    this.rows.push(...live.filter((t) => !known.has(t.id)));
    this.save();
    return this.rows;
  }
  forget(id) {
    this.rows = this.rows.filter((t) => t.id !== id);
    this.save();
  }
  save() {
    const text = JSON.stringify(this.rows);
    if (text === this.saved) return;
    fs.writeFileSync(this.file + ".tmp", text, { mode: 0o600 });
    fs.renameSync(this.file + ".tmp", this.file);
    this.saved = text;
  }
}
