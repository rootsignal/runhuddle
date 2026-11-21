import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { screenshotReferences, sendDashboardFollowUp } from "../main/dashboard-follow-up.mjs";

const entry = { provider: "Codex", sessionID: "conversation-1" };
const terminalId = "terminal-1";
const terminal = { id: terminalId, agent: "codex", sessionID: entry.sessionID };
const idle = { ...entry, terminalId, state: "idle" };
function fixture(overrides = {}) {
  const replies = { list: [terminal], sessions: [idle], replay: { data: "\x1b[?2004h" }, ...overrides };
  const writes = [];
  return {
    writes,
    service: {
      async call(method, payload) {
        if (method === "write") writes.push(payload);
        return replies[method];
      },
    },
  };
}

test("dashboard follow-up writes one bracketed paste to the exact idle terminal", async () => {
  const { service, writes } = fixture();
  await sendDashboardFollowUp(service, entry, terminalId, "Check the mobile layout.", () => true);
  assert.deepEqual(writes, [{ id: terminalId, data: "\x1b[200~Check the mobile layout.\x1b[201~\r" }]);
});

test("resumed Codex accepts dashboard follow-up only at a verified empty prompt", { skip: process.platform === "win32" }, async () => {
  const sessions = [{ ...idle, state: "disconnected" }];
  const prompt = "› Ask Codex to do anything\r\n← for agents · ? for shortcuts";
  const replay = { cols: 100, rows: 30, data: "\x1b[?2004h" + prompt };
  const ready = fixture({ sessions, replay });
  await sendDashboardFollowUp(ready.service, entry, terminalId, "Continue.", () => true);
  assert.equal(ready.writes.length, 1);
  for (const display of [
    "• Working (3s • esc to interrupt)\r\n" + prompt,
    "Would you like to run the following command?\r\nPermission required\r\n" + prompt,
    prompt.replace("Ask Codex to do anything", "unsent input"),
  ]) {
    const blocked = fixture({ sessions, replay: { ...replay, data: "\x1b[?2004h" + display } });
    await assert.rejects(sendDashboardFollowUp(blocked.service, entry, terminalId, "Continue.", () => true));
    assert.equal(blocked.writes.length, 0);
  }
});

test("long Unix Codex sessions can outlive the retained startup paste marker", { skip: process.platform === "win32" }, async () => {
  const history = "x".repeat(512 * 1024);
  const { service, writes } = fixture({ replay: { data: history } });
  await sendDashboardFollowUp(service, entry, terminalId, "Continue the review.", () => true);
  assert.deepEqual(writes, [{ id: terminalId, data: "\x1b[200~Continue the review.\x1b[201~\r" }]);

  const disabled = fixture({ replay: { data: history.slice(8) + "\x1b[?2004l" } });
  await assert.rejects(sendDashboardFollowUp(disabled.service, entry, terminalId, "Continue.", () => true));
  assert.deepEqual(disabled.writes, []);
});

test("dashboard follow-up leaves changed, blocked, or unsupported terminal prompts untouched", async () => {
  for (const overrides of [
    { list: [{ ...terminal, sessionID: "other" }] },
    { sessions: [{ ...idle, state: "needsInput" }] },
    { sessions: [{ ...idle, state: "working" }] },
    { replay: { data: "\x1b[?2004h\x1b[?2004l" } },
  ]) {
    const { service, writes } = fixture(overrides);
    await assert.rejects(sendDashboardFollowUp(service, entry, terminalId, "Hello", () => true));
    assert.deepEqual(writes, []);
  }
  const { service, writes } = fixture();
  await assert.rejects(sendDashboardFollowUp(service, entry, terminalId, "Hello", () => false));
  await assert.rejects(sendDashboardFollowUp(service, entry, terminalId, "Hello\rSecond input", () => true));
  assert.deepEqual(writes, []);
});

test("dashboard follow-up saves screenshot references in the same explicit submit", async () => {
  const { service, writes } = fixture();
  const images = [Uint8Array.of(1).buffer, Uint8Array.of(2).buffer];
  await sendDashboardFollowUp(service, entry, terminalId, "Compare these.", () => true,
    images, (image) => Buffer.from(image));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, terminalId);
  assert.ok(writes[0].data.startsWith("\x1b[200~Compare these.\n"));
  assert.ok(writes[0].data.endsWith("\x1b[201~\r"));
  const references = writes[0].data.slice(6, -7).match(screenshotReferences)?.[0] ?? "";
  const files = Array.from(references.matchAll(/^- "(.+)"$/gm), ([, file]) => file);
  try {
    assert.equal(files.length, 2);
    assert.deepEqual(await Promise.all(files.map((file) => fs.readFile(file))), [Buffer.from([1]), Buffer.from([2])]);
  } finally {
    if (files.length) await fs.rm(path.dirname(files[0]), { recursive: true, force: true });
  }
});

test("a cleared Codex lock screen does not block dashboard follow-ups", async () => {
  const lock = "This conversation is open in another app.\r\nClose it there and press R to continue here.";
  const prompt = "› Ask Codex to do anything\r\n← for agents · ? for shortcuts";
  const replay = { cols: 100, rows: 30, data: "\x1b[?2004h" + lock };
  const blocked = fixture({ replay });
  await assert.rejects(sendDashboardFollowUp(blocked.service, entry, terminalId, "Continue.", () => true),
    /terminal is not accepting dashboard messages/);
  assert.deepEqual(blocked.writes, []);

  const ready = fixture({ replay: { ...replay, data: replay.data + "\x1b[2J\x1b[H" + prompt } });
  await sendDashboardFollowUp(ready.service, entry, terminalId, "Continue.", () => true);
  assert.deepEqual(ready.writes, [{ id: terminalId, data: "\x1b[200~Continue.\x1b[201~\r" }]);
});

test("a terminal reset invalidates a retained bracketed-paste marker", async () => {
  const { service, writes } = fixture({ replay: {
    cols: 100, rows: 30, data: "\x1b[?2004h\x1bc",
  } });
  await assert.rejects(sendDashboardFollowUp(service, entry, terminalId, "Continue.", () => true),
    /terminal is not accepting dashboard messages/);
  assert.deepEqual(writes, []);
});

test("queued follow-up requires an empty Codex prompt even when the session reports idle", { skip: process.platform === "win32" }, async () => {
  const replay = { cols: 100, rows: 30, data: "\x1b[?2004h› Ask Codex to do anything\r\n← for agents · ? for shortcuts" };
  const blocked = fixture({ replay: { ...replay, data: replay.data.replace("Ask Codex to do anything", "unsent input") } });
  assert.equal(await sendDashboardFollowUp(blocked.service, entry, terminalId, "Continue.", () => true, [], undefined, true), "waiting");
  assert.deepEqual(blocked.writes, []);
  const ready = fixture({ replay });
  await sendDashboardFollowUp(ready.service, entry, terminalId, "Continue.", () => true, [], undefined, true);
  assert.equal(ready.writes.length, 1);
});
