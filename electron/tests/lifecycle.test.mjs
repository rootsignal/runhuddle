import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SessionLedger,
  mergeSessions,
  agentArguments,
  terminalEnvironment,
  transcriptEvent,
  watchTranscript,
  claudeHookState,
  codexTranscriptParser,
  copilotTranscriptParser,
} from "../main/lifecycle.mjs";
const id = "11111111-1111-4111-8111-111111111111";

test("current provider events distinguish prompts, approvals and completion", () => {
  const codexMessage = (role, type, text) => transcriptEvent("codex", {
    type: "response_item", payload: { type: "message", role, content: [{ type, text }] },
  });
  assert.equal(codexMessage("user", "input_text", "Fix the sidebar").promptTitle, "Fix the sidebar");
  assert.deepEqual(codexMessage("assistant", "output_text", "Still working"), { preview: "Still working" });
  const parseCodex = codexTranscriptParser();
  const codexItem = (type, call_id, name) =>
    parseCodex("codex", { type: "response_item", payload: { type, call_id, name } }).state;
  assert.equal(codexItem("function_call", "question", "request_user_input"), "needsInput");
  assert.equal(codexItem("function_call_output", "unrelated"), undefined);
  assert.equal(codexItem("function_call_output", "question"), "working");
  assert.equal(transcriptEvent("claude", {
    type: "user", message: { content: [{ type: "image" }, { type: "text", text: "Review this" }] },
  }).state, "working");
  assert.equal(claudeHookState({ type: "PermissionRequest" }), "needsInput");
  assert.equal(claudeHookState({ type: "SessionStart", source: "compact" }), undefined);
  assert.equal(claudeHookState({ type: "Stop" }), "idle");

  const parse = copilotTranscriptParser();
  const copilot = (type, requestId) => parse("copilot", { type, data: { requestId } }).state;
  assert.equal(copilot("session.start"), "idle");
  assert.equal(copilot("user.message"), "working");
  assert.equal(copilot("permission.requested", "a"), "needsInput");
  assert.equal(copilot("user_input.requested", "b"), "needsInput");
  assert.equal(copilot("permission.completed", "a"), "needsInput");
  assert.equal(copilot("user_input.completed", "b"), "working");
  assert.equal(copilot("session.idle"), "idle");
  assert.equal(copilot("user.message"), "working");
  assert.equal(parse("copilot", {
    type: "tool.execution_start", data: { toolName: "ask_user", toolCallId: "question" },
  }).state, "needsInput");
  assert.equal(parse("copilot", {
    type: "tool.execution_complete", data: { toolCallId: "question" },
  }).state, "working");
  assert.equal(copilot("assistant.turn_end"), "idle");
});

test("Claude hook reports only its own session and leaves CLI decisions untouched", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-claude-hook-"));
  const file = path.join(dir, "activity.jsonl");
  const script = fileURLToPath(new URL("../main/claude-activity.cjs", import.meta.url));
  const send = (payload) => {
    const result = spawnSync(process.execPath, [script, file, id], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      input: JSON.stringify(payload),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  };
  try {
    send({ session_id: "other", hook_event_name: "Stop" });
    send({ session_id: id, agent_id: "subagent", hook_event_name: "Stop" });
    assert.equal(fs.existsSync(file), false);
    send({ session_id: id, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "private" } });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { type: "PermissionRequest", tool: "Bash" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
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
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
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
  fs.writeFileSync(file, '{"type":"event_msg","payload":{"type":"task_started"}}\n');
  const patches = [];
  const stop = watchTranscript(file, "codex", (p) => patches.push(p), {
    baseline: fs.statSync(file),
  });
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
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
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
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  }
});

test("first user prompt supplies a bounded title suggestion for each provider", () => {
  for (const [agent, event] of [
    [
      "codex",
      {
        type: "event_msg",
        payload: { type: "user_message", message: "Fix the sidebar\nDetails" },
      },
    ],
    [
      "claude",
      { type: "user", message: { content: "Fix the sidebar\nDetails" } },
    ],
    [
      "copilot",
      { type: "user.message", data: { content: "Fix the sidebar\nDetails" } },
    ],
  ])
    assert.equal(transcriptEvent(agent, event).promptTitle, "Fix the sidebar");
  assert.equal(
    transcriptEvent("codex", {
      type: "event_msg",
      payload: { type: "agent_message", message: "Do not rename from replies" },
    }).promptTitle,
    undefined,
  );
});

test("owned status wins over newer native snapshots for every provider", () => {
  for (const provider of ["Claude", "Codex", "Copilot"]) {
    const native = {
      provider,
      sessionID: id,
      state: "working",
      updated: 999,
      title: "Stale",
    };
    const owned = {
      provider,
      sessionID: id,
      state: "idle",
      updated: 1,
      title: "Current",
      terminalId: "live",
    };
    assert.equal(mergeSessions([native], [owned])[0].state, "idle");
    assert.equal(mergeSessions([native], [owned])[0].title, "Current");
    assert.equal(
      mergeSessions(
        [native],
        [{ ...owned, terminalId: undefined, state: "saved" }],
      )[0].state,
      "saved",
    );
  }
});

test("observer preserves split UTF-8 and reads replacement transcripts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-unicode-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, "");
  const patches = [];
  const stop = watchTranscript(file, "copilot", (p) => patches.push(p));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const bytes = Buffer.from(
      JSON.stringify({
        type: "assistant.message",
        data: { content: "Hello 🐈" },
      }) + "\n",
    );
    const split = bytes.indexOf(Buffer.from("🐈")) + 2;
    fs.appendFileSync(file, bytes.subarray(0, split));
    await wait(250);
    fs.appendFileSync(file, bytes.subarray(split));
    await wait(250);
    assert.equal(patches.at(-1).preview, "Hello 🐈");
    fs.writeFileSync(
      file + ".new",
      JSON.stringify({ type: "assistant.turn_end" }) + "\n",
    );
    fs.renameSync(file + ".new", file);
    await wait(250);
    assert.equal(patches.at(-1).state, "idle");
  } finally {
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("continuous transcript output cannot postpone status indefinitely", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-stream-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, "");
  const patches = [];
  const stop = watchTranscript(file, "claude", (p) => patches.push(p));
  let interval;
  try {
    fs.appendFileSync(
      file,
      JSON.stringify({
        type: "assistant",
        message: { stop_reason: "end_turn" },
      }) + "\n",
    );
    interval = setInterval(() => fs.appendFileSync(file, "{}\n"), 20);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(patches[0]?.state, "idle");
  } finally {
    clearInterval(interval);
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removing an older terminal cannot release a resumed conversation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-ownership-"));
  try {
    const ledger = new SessionLedger(dir);
    for (const provider of ["Claude", "Codex", "Copilot"]) {
      ledger.update(provider, id, { terminalId: "old", state: "idle" });
      assert.equal(ledger.release(provider, id, "old"), true);
      ledger.update(provider, id, { terminalId: "resumed", state: "working" });
      assert.equal(ledger.release(provider, id, "old"), false);
      const row = ledger.list().find((r) => r.provider === provider);
      assert.equal(row.terminalId, "resumed");
      assert.equal(row.state, "working");
      assert.equal(ledger.release(provider, id, "resumed"), true);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
