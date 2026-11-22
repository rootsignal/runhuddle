import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { parseHistory, pendingQuestions, readAttentionPreview } from "../main/history.mjs";
import { readHandoffHistory } from "../main/handoff-history.mjs";
import { readSessionContext } from "../main/session-context.mjs";
import { HistoryIndex } from "../main/history-index.mjs";
import { historyIndexClient } from "../main/history-index-client.mjs";

import { readHistoryAround, searchHistory } from "../main/history-search.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const lines = (rows) => rows.map(JSON.stringify).join("\n");

test("handoffs keep readable provider summaries alongside new messages", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "runhuddle-handoff-"));
  const keys = ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "COPILOT_HOME"];
  const previous = keys.map((key) => process.env[key]);
  for (const key of keys) process.env[key] = home;
  const sessionID = "11111111-1111-4111-8111-111111111111";
  const codex = path.join(home, "rollout.jsonl");
  const claude = path.join(home, "projects", home.replace(/[^a-zA-Z0-9]/g, "-"), sessionID + ".jsonl");
  const copilot = path.join(home, "session-state", sessionID, "events.jsonl");
  const checkpoints = path.join(path.dirname(copilot), "checkpoints");
  try {
    const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
    try {
      db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT)");
      db.prepare("INSERT INTO threads VALUES (?, ?)").run(sessionID, codex);
    } finally { db.close(); }
    const codexProgress = { type: "event_msg", payload: { type: "user_message", message: "Continue with tests." } };
    fs.writeFileSync(codex, lines([
      { type: "compacted", payload: { message: "Preserve the old route." } },
      codexProgress,
    ]));
    fs.mkdirSync(path.dirname(claude), { recursive: true });
    fs.writeFileSync(claude, lines([
      { type: "user", isCompactSummary: true, isMeta: true, message: { content: "Preserve the public API." } },
      { type: "user", message: { content: "Continue with tests." } },
      { type: "user", isCompactSummary: true, isSidechain: true, message: { content: "Unrelated subagent." } },
    ]));
    fs.mkdirSync(checkpoints, { recursive: true });
    const copilotProgress = { type: "user.message", data: { content: "Continue with tests." } };
    fs.writeFileSync(copilot, lines([
      { type: "session.compaction_complete", data: { success: true, summaryContent: "Keep the old schema." } },
      copilotProgress,
      { type: "session.compaction_complete", data: { success: false, summaryContent: "Ignore failed summary." } },
    ]));
    const handoff = (provider) => readHandoffHistory({ provider, sessionID, cwd: home });
    for (const [provider, expected] of [
      ["Codex", "Preserve the old route."], ["Claude", "Preserve the public API."], ["Copilot", "Keep the old schema."],
    ]) {
      const result = await handoff(provider);
      assert.equal(result.compactionSummary, expected);
      assert.deepEqual(result.messages.map((message) => message.text), ["Continue with tests."]);
    }

    fs.writeFileSync(codex, lines([
      { type: "compacted", payload: { message: "", replacement_history: [{ type: "compaction", encrypted_content: "opaque" }] } },
      codexProgress,
    ]));
    assert.equal((await handoff("Codex")).compactionSummary, undefined);
    fs.writeFileSync(copilot, lines([copilotProgress]));
    fs.writeFileSync(path.join(checkpoints, "index.md"), "| 1 | Old | [Read](001.md) |\n| 2 | New | [Read](002.md) |\n");
    fs.writeFileSync(path.join(checkpoints, "002.md"), "Checkpoint with the latest decision.");
    assert.equal((await handoff("Copilot")).compactionSummary, "Checkpoint with the latest decision.");
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Codex session context counts rollout records across the entire transcript and follows appends", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "runhuddle-context-"));
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    const file = path.join(home, "rollout.jsonl");
    const session = { provider: "Codex", sessionID: "11111111-1111-4111-8111-111111111111", cwd: home };
    const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
    try {
      db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT)");
      db.prepare("INSERT INTO threads VALUES (?, ?)").run(session.sessionID, file);
    } finally { db.close(); }
    const timestamp = "2026-11-19T18:00:00.000Z";
    const compaction = { type: "compacted", payload: { message: "Context summary" } };
    fs.writeFileSync(file, lines([
      { type: "session_meta", timestamp },
      compaction,
      { type: "event_msg", payload: { type: "context_compacted" } },
      { type: "response_item", payload: { type: "compacted", text: "é".repeat(3 * 1024 * 1024) } },
    ]) + "\n" + JSON.stringify(compaction).slice(0, -1));
    assert.deepEqual(await readSessionContext(session), { startedAt: Date.parse(timestamp), compactions: 1 });
    fs.appendFileSync(file, "}\n");
    assert.deepEqual(await readSessionContext(session), { startedAt: Date.parse(timestamp), compactions: 2 });
    assert.equal(await readSessionContext({ ...session, provider: "Claude" }), undefined);
    fs.writeFileSync(file, lines([{ type: "session_meta", timestamp }]) + "\n");
    assert.deepEqual(await readSessionContext(session), { startedAt: Date.parse(timestamp), compactions: 0 });
    fs.rmSync(file);
    assert.equal(await readSessionContext(session), undefined);
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Codex preview recovers recent turns behind large tool output", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "runhuddle-preview-"));
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    const transcript = path.join(home, "session.jsonl");
    const database = new DatabaseSync(path.join(home, "state_5.sqlite"));
    try {
      database.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT)");
      database.prepare("INSERT INTO threads VALUES (?, ?)").run("11111111-1111-4111-8111-111111111111", transcript);
    } finally {
      database.close();
    }
    const message = (role, text) => ({
      type: "response_item",
      payload: { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] },
    });
    fs.writeFileSync(transcript, lines([
      message("user", "Earlier instruction"),
      message("assistant", "Earlier reply"),
      message("user", "Release the dashboard"),
      { type: "response_item", payload: { type: "function_call_output", output: "x".repeat(5 * 1024 * 1024) } },
      message("assistant", "The release is live."),
    ]));
    const preview = await readAttentionPreview({ provider: "Codex", sessionID: "11111111-1111-4111-8111-111111111111", cwd: home }, "completion", true);
    assert.equal(preview.instruction, "Release the dashboard");
    assert.equal(preview.answer, "The release is live.");
    assert.deepEqual(preview.recentTurns.map((turn) => turn.instruction), ["Earlier instruction", "Release the dashboard"]);
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
test("history uses Codex conversation events without duplicate response items", () => {
  const result = parseHistory(
    "codex",
    lines([
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      },
      {
        type: "event_msg",
        payload: { type: "user_message", message: "hello" },
      },
      { type: "event_msg", payload: { type: "agent_message", message: "hi" } },
      { type: "event_msg", payload: { type: "task_started" } },
    ]),
  );
  assert.deepEqual(
    result.map((m) => [m.role, m.text]),
    [
      ["user", "hello"],
      ["assistant", "hi"],
    ],
  );
});
test("history extracts text, excludes tool payloads and handles incomplete records", () => {
  const result = parseHistory(
    "claude",
    lines([
      { type: "user", message: { content: "question" } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "private" },
            { type: "text", text: "answer" },
            { type: "tool_use", input: "hidden" },
          ],
        },
      },
      {
        type: "assistant",
        isSidechain: true,
        message: { content: "subagent" },
      },
    ]) + '\n{"partial":',
  );
  assert.deepEqual(
    result.map((m) => m.text),
    ["question", "answer"],
  );
  assert.equal(
    parseHistory(
      "copilot",
      lines([{ type: "assistant.message", data: { content: "reply" } }]),
    )[0].text,
    "reply",
  );
});

test("attention previews show pending questions and leave out resolved requests", () => {
  const question = "Which environment should I use?";
  const codex = (type, call_id, fields = {}) => ({ type: "response_item", payload: { type, call_id, ...fields } });
  const ask = (id, text, options = []) => codex("function_call", id, {
    name: "request_user_input", arguments: JSON.stringify({ questions: [{ question: text, options }] }),
  });
  assert.deepEqual(pendingQuestions("codex", lines([
    ask("old", "Already answered"),
    codex("function_call_output", "old"),
    ask("pending", question, [{ label: "Staging" }, { label: "Local" }]),
    codex("function_call", "other", { name: "shell", arguments: "Tool payload" }),
  ])), [{ text: question, choices: ["Staging", "Local"] }]);

  const claude = (type, ...content) => ({ type, message: { content } });
  assert.deepEqual(pendingQuestions("claude", lines([
    claude("assistant", { type: "tool_use", id: "old", name: "AskUserQuestion", input: { questions: [{ question: "Old question" }] } }),
    claude("user", { type: "tool_result", tool_use_id: "old" }),
    claude("assistant", { type: "tool_use", id: "pending", name: "AskUserQuestion", input: { questions: [{ question }] } }),
  ])), [{ text: question, choices: [] }]);

  assert.deepEqual(pendingQuestions("copilot", lines([
    { type: "user_input.requested", data: { requestId: "old", question: "Old question" } },
    { type: "user_input.completed", data: { requestId: "old" } },
    { type: "user_input.requested", data: { requestId: "pending", question } },
    { type: "permission.requested", data: { requestId: "permission", command: "Tool command" } },
  ])), [{ text: question, choices: [] }]);
});

test("full history search jumps beyond the recent window and rejects a stale match", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-history-search-"));
  const original = process.env.COPILOT_HOME;
  process.env.COPILOT_HOME = dir;
  try {
    const session = {
      provider: "Copilot",
      sessionID: "11111111-1111-4111-8111-111111111111",
      title: "Decision",
      cwd: dir,
    };
    const folder = path.join(dir, "session-state", session.sessionID);
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, "events.jsonl");
    const message = (content) =>
      JSON.stringify({ type: "assistant.message", data: { content } }) + "\r\n";
    const first = message("Initial context 🐈");
    fs.writeFileSync(
      file,
      first +
        message("Use the violet route for the handover.") +
        JSON.stringify({
          type: "tool.execution_start",
          data: { arguments: "ignored payload" },
        }) +
        "\r\n" +
        message("Follow-up " + "x".repeat(17000)).repeat(260),
    );
    const found = await searchHistory([session], "VIOLET handover");
    assert.equal(found.results.length, 1);
    const [row] = found.results;
    assert.equal(row.anchor.offset, Buffer.byteLength(first));
    assert.match(row.snippet, /violet route/);
    const view = await readHistoryAround(session, row.anchor);
    assert.equal(
      view.messages.find((item) => item.match)?.text,
      "Use the violet route for the handover.",
    );
    assert.ok(view.messages.some((item) => item.text === "Initial context 🐈"));
    assert.deepEqual(
      (await searchHistory([session], "ignored payload")).results,
      [],
    );
    fs.writeFileSync(file, first + message("This conversation rotated."));
    assert.equal(
      (await readHistoryAround(session, row.anchor)).matchMissing,
      true,
    );
  } finally {
    if (original === undefined) delete process.env.COPILOT_HOME;
    else process.env.COPILOT_HOME = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the history index reopens, reads appends, and drops replaced or removed history", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-history-index-"));
  const original = process.env.COPILOT_HOME;
  process.env.COPILOT_HOME = dir;
  let index;
  try {
    const session = {
      provider: "Copilot",
      sessionID: "11111111-1111-4111-8111-111111111111",
      title: "Decision",
      cwd: dir,
    };
    const file = path.join(dir, "session-state", session.sessionID, "events.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const message = (content) =>
      JSON.stringify({ type: "assistant.message", data: { content } }) + "\r\n";
    const first = message('Initial context 🐈 says "violet route".');
    const second = message("Use the new handover.");
    fs.writeFileSync(file, first + second.slice(0, -5));
    const database = path.join(dir, "index", "history.sqlite");
    index = new HistoryIndex(database);
    assert.equal(await index.sync(session), Buffer.byteLength(first + second.slice(0, -5)));
    const initial = (await searchHistory([session], '"Violet route"')).results;
    assert.equal(initial.length, 1);
    assert.deepEqual(index.search([session], '"Violet route"').results, initial);
    assert.equal(index.search([session], "🐈").results.length, 1);
    assert.equal(index.search([session], "vi").results.length, 1);
    assert.equal(index.search([], "violet").results.length, 0);
    assert.equal(index.search([session], "handover").results.length, 0);
    index.close();
    index = new HistoryIndex(database);
    assert.equal(await index.sync(session), 0);
    fs.appendFileSync(file, second.slice(-5, -2));
    assert.equal(await index.sync(session), Buffer.byteLength(second.slice(0, -2)));
    const [row] = index.search([session], "handover").results;
    assert.equal(row.anchor.offset, Buffer.byteLength(first));
    assert.equal((await readHistoryAround(session, row.anchor)).matchMissing, false);
    fs.appendFileSync(file, "\r\n" + message("Another update."));
    assert.equal(await index.sync(session), Buffer.byteLength(second + message("Another update.")));
    assert.equal(index.search([session], "handover").results.length, 1);
    assert.equal(index.search([session], "update").results.length, 1);

    const replacement = message("This conversation rotated.") + message("x".repeat(500));
    fs.writeFileSync(file, replacement);
    assert.equal(await index.sync(session), Buffer.byteLength(replacement));
    assert.equal(index.search([session], "violet").results.length, 0);
    assert.equal(index.search([session], "rotated").results.length, 1);
    fs.unlinkSync(file);
    await index.sync(session);
    assert.equal(index.search([session], "rotated").results.length, 0);

    fs.writeFileSync(file, first);
    await index.sync(session);
    index.prune(new Set());
    assert.equal(index.search([session], "violet").results.length, 0);
  } finally {
    index?.close();
    if (original === undefined) delete process.env.COPILOT_HOME;
    else process.env.COPILOT_HOME = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the history worker publishes updated results after background indexing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-index-worker-"));
  const original = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  const session = {
    provider: "Claude",
    sessionID: "22222222-2222-4222-8222-222222222222",
    title: "Background search",
    cwd: dir,
    updated: 1,
  };
  const file = path.join(dir, "projects", dir.replace(/[^a-zA-Z0-9]/g, "-"), session.sessionID + ".jsonl");
  const message = (content) =>
    JSON.stringify({ type: "user", message: { content } }) + "\n";
  let updated;
  const client = historyIndexClient(path.join(dir, "index", "history.sqlite"), () => updated?.());
  async function waitForUpdate() {
    const { promise, resolve } = Promise.withResolvers();
    updated = resolve;
    const timeout = setTimeout(() => resolve(false), 5000);
    try {
      assert.notEqual(await promise, false, "index progress was published");
    } finally {
      clearTimeout(timeout);
      updated = undefined;
    }
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, message("Read the first indexed conversation."));
    const initialUpdate = waitForUpdate();
    const initial = await client.search([session], "first indexed", true);
    assert.equal(initial.indexing, true);
    assert.deepEqual(initial.results, []);
    await initialUpdate;
    const ready = await client.search([session], "first indexed", false);
    assert.equal(ready.indexing, false);
    assert.equal(ready.results.length, 1);

    fs.appendFileSync(file, message("Appended quartz markers."));
    const appended = waitForUpdate();
    client.sync([{ ...session, updated: 2 }], true);
    await appended;
    const result = await client.search([session], "quartz", false);
    assert.equal(result.indexing, false);
    assert.equal(result.results.length, 1);
  } finally {
    await client.close();
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
