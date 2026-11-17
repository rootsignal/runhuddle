import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SessionLedger,
  mergeSessions,
  agentArguments,
  terminalEnvironment,
  transcriptEvent,
  watchTranscript,
} from "../main/lifecycle.mjs";
const id = "11111111-1111-4111-8111-111111111111";
test("exact provider identity merges history without merging same folder or title", () => {
  const rows = mergeSessions(
    [
      { provider: "Codex", sessionID: id, title: "Same", cwd: "/project" },
      { provider: "Claude", sessionID: id, title: "Same", cwd: "/project" },
      { provider: "Codex", sessionID: "other", title: "Same", cwd: "/project" },
    ],
    [
      {
        provider: "Codex",
        sessionID: id,
        title: "Live title",
        terminalId: "pty",
        state: "working",
      },
    ],
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].terminalId, "pty");
  assert.equal(rows[1].terminalId, undefined);
  assert.equal(rows[0].title, "Live title");
});
test("owned history survives helper restart, clears dead ownership, and retains archives", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-ledger-"));
  try {
    const l = new SessionLedger(dir);
    l.update("Claude", id, {
      cwd: dir,
      terminalId: "live",
      state: "working",
      title: "Keep this",
    });
    const restored = new SessionLedger(dir);
    assert.equal(restored.list()[0].state, "saved");
    assert.equal(restored.list()[0].terminalId, undefined);
    assert.equal(restored.list()[0].title, "Keep this");
    restored.update("Claude", id, { state: "archived" });
    assert.equal(new SessionLedger(dir).list()[0].state, "archived");
    restored.update("Claude", id, { state: "saved" });
    assert.equal(new SessionLedger(dir).list()[0].state, "saved");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("resume uses exact IDs and rejects command injection; color disabling does not leak into PTYs", () => {
  assert.deepEqual(agentArguments("codex", id), [
    "codex",
    "resume",
    "--no-daemon",
    id,
  ]);
  assert.deepEqual(agentArguments("claude", id, true), [
    "claude",
    "--resume",
    id,
  ]);
  assert.deepEqual(agentArguments("copilot", id), [
    "copilot",
    "--session-id",
    id,
  ]);
  assert.throws(() => agentArguments("codex", "x;echo hacked"));
  const env = terminalEnvironment({
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    ELECTRON_RUN_AS_NODE: "1",
    NODE_OPTIONS: "bad",
    PATH: "keep",
  });
  assert.equal(env.NO_COLOR, undefined);
  assert.equal(env.FORCE_COLOR, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.PATH, "keep");
  assert.equal(env.COLORTERM, "truecolor");
});
test("activity follows completion events, not arbitrary assistant output or tool results", () => {
  assert.equal(
    transcriptEvent("codex", {
      type: "event_msg",
      payload: { type: "task_started" },
    }).state,
    "working",
  );
  assert.equal(
    transcriptEvent("codex", {
      type: "event_msg",
      payload: { type: "task_complete" },
    }).state,
    "idle",
  );
  assert.equal(
    transcriptEvent("claude", {
      type: "assistant",
      message: { stop_reason: "tool_use" },
    }).state,
    "working",
  );
  assert.equal(
    transcriptEvent("claude", {
      type: "assistant",
      message: { stop_reason: "end_turn" },
    }).state,
    "idle",
  );
  assert.equal(
    transcriptEvent("claude", {
      type: "user",
      message: { content: [{ type: "tool_result" }] },
    }).state,
    undefined,
  );
  assert.equal(
    transcriptEvent("copilot", { type: "assistant.turn_end" }).state,
    "idle",
  );
  assert.equal(
    transcriptEvent("copilot", {
      type: "assistant.message",
      data: { content: "Still thinking" },
    }).state,
    undefined,
  );
});
test("transcript observer consumes appended events including partial lines without polling", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-events-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, "");
  const patches = [];
  const stop = watchTranscript(file, "codex", (p) => patches.push(p));
  try {
    fs.appendFileSync(file, '{"type":"event_msg","payload":');
    await new Promise((r) => setTimeout(r, 220));
    assert.equal(patches.length, 0);
    fs.appendFileSync(file, '{"type":"task_complete"}}\n');
    for (let i = 0; i < 20 && !patches.length; i++)
      await new Promise((r) => setTimeout(r, 50));
    assert.equal(patches[0].state, "idle");
    const count = patches.length;
    await new Promise((r) => setTimeout(r, 220));
    assert.equal(patches.length, count);
  } finally {
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("helper persists imported archive state across a full service restart", async () => {
  const { Service } = await import("../main/service.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-history-service-"));
  let client = new Service(dir);
  try {
    await client.connect();
    await client.call("adopt", {
      session: {
        provider: "Claude",
        sessionID: id,
        cwd: dir,
        title: "Retained history",
        preview: "Keep context",
      },
    });
    await client.call("archive", {
      provider: "Claude",
      sessionID: id,
      archived: true,
    });
    assert.equal((await client.call("sessions"))[0].state, "archived");
    await client.call("shutdown");
    client.disconnect();
    await new Promise((r) => setTimeout(r, 150));
    client = new Service(dir);
    await client.connect();
    const rows = await client.call("sessions");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Retained history");
    assert.equal(rows[0].state, "archived");
    await client.call("archive", {
      provider: "Claude",
      sessionID: id,
      archived: false,
    });
    assert.equal((await client.call("sessions"))[0].state, "saved");
  } finally {
    try {
      await client.call("shutdown");
    } catch {}
    client.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
