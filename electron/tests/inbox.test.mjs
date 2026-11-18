import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInbox } from "../main/inbox.mjs";

test("Inbox persists unread completions and removes resolved input without losing completions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-inbox-"));
  try {
    const file = path.join(dir, "inbox.json");
    let updates = 0;
    const inbox = createInbox(file, () => updates++);
    const source = {
      provider: "Codex",
      sessionID: "same-id",
      body: "Review the changes",
    };
    const older = inbox.complete(source);
    const current = inbox.complete(source);
    inbox.dismiss(older);
    assert.notEqual(older, current);
    assert.deepEqual(
      inbox.list().map((row) => row.id),
      [current],
    );
    const waiting = {
      provider: "Claude",
      sessionID: "same-id",
      terminalId: "tty",
      state: "needsInput",
      title: "Approve a step",
    };
    inbox.sync([waiting]);
    const sent = updates;
    inbox.sync([{ ...waiting, updated: 123 }]);
    assert.equal(updates, sent);
    assert.deepEqual(
      inbox.list().map((row) => row.kind),
      ["input", "completion"],
    );
    inbox.dismiss("input:Claude:same-id");
    assert.equal(inbox.list().length, 2);
    inbox.sync([{ ...waiting, state: "working" }]);
    assert.deepEqual(
      inbox.list().map((row) => row.id),
      [current],
    );
    const reopened = createInbox(file, () => {});
    assert.deepEqual(reopened.list(), inbox.list());
    reopened.dismiss(current);
    assert.deepEqual(createInbox(file, () => {}).list(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
