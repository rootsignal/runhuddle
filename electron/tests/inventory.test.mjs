import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TerminalInventory } from "../main/terminal-inventory.mjs";
test("lost terminals retain layout identities across restart and reconnect without duplication", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-inventory-"));
  const file = path.join(dir, "inventory.json");
  try {
    const t = { id: "pty", cwd: dir, agent: "shell", exited: false };
    const inventory = new TerminalInventory(file);
    inventory.reconcile([t]);
    const restored = new TerminalInventory(file);
    assert.equal(restored.reconcile([])[0].unavailable, true);
    assert.equal(restored.reconcile([t]).length, 1);
    assert.equal(restored.rows[0].unavailable, undefined);
    assert.equal(restored.rows[0].exited, false);
    restored.forget(t.id);
    assert.deepEqual(new TerminalInventory(file).reconcile([]), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
