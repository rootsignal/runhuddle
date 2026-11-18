import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateRecap, parseRecap, recapPrompt, recapStore } from "../main/recaps.mjs";

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
