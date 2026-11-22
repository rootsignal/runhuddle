import { createQuickReplies } from "../main/quick-replies.mjs";
import { reviewProjectHistory } from "../main/project-history-review.mjs";
import { readHistoryAround } from "../main/history-search.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateRecap, installedReviewAgents, parseRecap, recapPrompt, recapStore } from "../main/recaps.mjs";

test("AI quick replies cap context and reuse a turn request", async () => {
  let calls = 0;
  const service = createQuickReplies(async (prompt, agent) => {
    calls++;
    assert.equal(agent, "claude");
    const context = JSON.parse(prompt.slice(prompt.lastIndexOf("\n\n") + 2));
    assert.equal(context.instruction.length, 600);
    assert.ok(context.answer.length <= 3000);
    assert.match(context.answer, /Next up is project search\.$/);
    return { output: JSON.stringify([
      { label: "Improve project search", draft: "Please improve project search." },
      { label: "Summarize what changed", draft: "Summarize what changed." },
      { label: "Command", draft: "/compact" },
    ]) };
  });
  const run = () => service.suggest("Claude:fixture", "claude", "x".repeat(1000),
    "Recap. " + "x".repeat(5000) + " Next up is project search.");
  const first = run();
  assert.equal(run(), first);
  assert.deepEqual(await first, [{ label: "Improve project search", draft: "Please improve project search." }]);
  assert.equal(run(), first);
  assert.equal(calls, 1);
  service.close();
});

const draft = { done: "Reviewed workspace navigation.", pending: "", next: "Open the terminal." };
test("recaps bound conversation context and persist only validated text", () => {
  const messages = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    text: "start " + "x".repeat(2000) + " conclusion " + i,
  }));
  const prompt = recapPrompt(messages);
  const context = JSON.parse(prompt.slice(prompt.lastIndexOf("\n\n") + 2));
  assert.ok(context.reduce((n, row) => n + row.text.length, 0) <= 16000);
  assert.match(context.at(-1).text, /conclusion 39$/);
  assert.doesNotMatch(prompt, /conclusion 1"/);
  assert.deepEqual(parseRecap("```json\n" + JSON.stringify(draft) + "\n```"), draft);
  assert.throws(() => parseRecap('{"done":1,"pending":"","next":""}'), /unusable recap/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-recap-store-"));
  try {
    const file = path.join(dir, "recaps", "recaps.sqlite");
    const key = "Claude:test-id";
    const row = { ...draft, agent: "Copilot", generatedAt: 42, sourceUpdated: 30 };
    const store = recapStore(file);
    assert.deepEqual(store.list(), {});
    store.save(key, row);
    assert.deepEqual(recapStore(file).list(), { [key]: row });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recap generation can use each CLI independently of the source agent", {
  skip: process.platform === "win32" ? "The CLI fixture uses a POSIX login shell" : false,
}, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-recap-cli-"));
  const session = {
    provider: "Claude",
    sessionID: "11111111-1111-4111-8111-111111111111",
    cwd: dir,
    updated: 42,
  };
  const original = { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    COPILOT_HOME: process.env.COPILOT_HOME };
  const shell = path.join(dir, "fixture-login");
  t.mock.method(os, "userInfo", () => ({ shell }));
  try {
    fs.writeFileSync(shell, '#!/bin/sh\nexec /bin/sh -c "$2"\n', { mode: 0o700 });
    const projects = path.join(dir, "projects", dir.replace(/[^a-zA-Z0-9]/g, "-"));
    fs.mkdirSync(projects, { recursive: true });
    fs.writeFileSync(path.join(projects, session.sessionID + ".jsonl"),
      JSON.stringify({ type: "user", message: { content: "Review workspace navigation." } }) + "\n");
    process.env.PATH = dir + path.delimiter + original.PATH;
    process.env.CLAUDE_CONFIG_DIR = dir;
    process.env.COPILOT_HOME = dir;
    const cliFolder = path.join(dir, "available-agents");
    fs.mkdirSync(cliFolder);
    fs.writeFileSync(path.join(cliFolder, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    process.env.PATH = cliFolder;
    assert.deepEqual(await installedReviewAgents(), ["claude"]);
    process.env.PATH = dir + path.delimiter + original.PATH;
    for (const agent of ["codex", "claude", "copilot"]) {
      const output = agent === "codex" ? " > recap.json" : "";
      const flag = { codex: "--ephemeral", claude: "--no-session-persistence", copilot: "--available-tools=" }[agent];
      const model = agent === "claude" ? "haiku" : "gpt-6-luna";
      fs.writeFileSync(path.join(dir, agent), [
        "#!/bin/sh",
        'case " $* " in *" ' + flag + ' "*) ;; *) exit 22 ;; esac',
        'case " $* " in *" --model ' + model + ' "*) ;; *) exit 25 ;; esac',
        'case "$PWD" in *runhuddle-recap-*) ;; *) exit 23 ;; esac',
        "grep -q 'Review workspace navigation.' || exit 24",
        "printf '%s' '" + JSON.stringify(draft) + "'" + output,
      ].join("\n") + "\n", { mode: 0o700 });
      const result = await generateRecap(session, agent, new AbortController().signal);
      assert.equal(result.agent.toLowerCase(), agent);
      assert.equal(result.model, agent === "claude" ? "Haiku" : "GPT-6 Luna");
      assert.equal(result.sourceUpdated, 42);
      assert.equal(result.next, draft.next);
    }
    const saved = Array.from({ length: 23 }, (_, index) => ({
      ...session, sessionID: `88888888-8888-4888-8888-${String(index).padStart(12, "0")}`, title: `Saved session ${index + 1}`,
    }));
    for (const row of saved) {
      fs.writeFileSync(path.join(projects, row.sessionID + ".jsonl"), JSON.stringify({
        type: "assistant", message: { content: [{ type: "text", text: `Next step for ${row.title}. Verify the release checklist.` }] },
      }) + "\n");
    }
    const response = [{ session: 22, message: 0, next: "Verify the release checklist.", quote: "Verify the release checklist." }];
    fs.writeFileSync(path.join(dir, "claude"), [
      "#!/bin/sh",
      `case "$(cat)" in *'Next step for Saved session 23.'*'"contextOnly":true'*) ;; *) exit 24 ;; esac`,
      "printf '%s' '" + JSON.stringify(response) + "'",
    ].join("\n") + "\n", { mode: 0o700 });
    const review = await reviewProjectHistory(saved, "claude", new AbortController().signal, {
      project: "Fixture project",
      liveSessions: [session],
    });
    assert.equal(review.reviewed, 23);
    assert.equal(review.total, 23);
    assert.equal(review.suggestions[0].source.sessionID, saved[22].sessionID);
    const source = await readHistoryAround(saved[22], review.suggestions[0].source.anchor);
    assert.equal(source.matchMissing, false);
    assert.match(source.messages.find((message) => message.match).text, /Verify the release checklist/);
    fs.unlinkSync(path.join(dir, "claude"));
    fs.writeFileSync(path.join(dir, "claude"), "#!/bin/sh\nexit 127\n", { mode: 0o700 });
    await assert.rejects(generateRecap(session, "claude", new AbortController().signal), /choose another agent/);
    const canceled = new AbortController();
    canceled.abort();
    await assert.rejects(generateRecap(session, "copilot", canceled.signal), { name: "AbortError" });
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
