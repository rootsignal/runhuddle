import test from "node:test";
import assert from "node:assert/strict";
import { createSessionAlerts } from "../main/session-alerts.mjs";
import { transcriptEvent } from "../main/lifecycle.mjs";

test("session alerts are based on live transitions and the terminal currently in view", () => {
  const delivered = [];
  const dismissed = [];
  let viewing = "tty-codex";
  const alerts = createSessionAlerts({
    isViewing: (id) => id === viewing,
    deliver: (key, alert) => delivered.push({ key, ...alert }),
    dismiss: (key) => dismissed.push(key),
  });
  const codex = {
    provider: "Codex",
    sessionID: "same-id",
    terminalId: "tty-codex",
    title: "Codex work",
  };
  const claude = {
    provider: "Claude",
    sessionID: "same-id",
    terminalId: "tty-claude",
    title: "Claude work",
  };
  const states = (a, b) => [
    { ...codex, state: a },
    { ...claude, state: b },
  ];
  alerts.seed(states("idle", "needsInput"));
  alerts.update(states("working", "working"));
  alerts.update(states("needsInput", "needsInput"));
  alerts.update(
    states("needsInput", "needsInput").map((row) => ({
      ...row,
      preview: "changed",
    })),
  );
  assert.deepEqual(
    delivered.map((alert) => alert.title),
    ["Claude needs input"],
  );
  assert.equal(delivered[0].key, "Claude:same-id");
  viewing = null;
  alerts.update(states("working", "working"));
  const abandoned = transcriptEvent("codex", {
    type: "event_msg",
    payload: { type: "turn_aborted" },
  });
  alerts.update([
    { ...codex, ...abandoned },
    { ...claude, state: "idle" },
  ]);
  assert.deepEqual(
    delivered.map((alert) => alert.title),
    ["Claude needs input", "Claude is ready for review"],
  );
  assert.ok(dismissed.includes("Claude:same-id"));
  alerts.seed(states("working", "working"));
  assert.equal(delivered.length, 2);
  const done = transcriptEvent("codex", {
    type: "event_msg",
    payload: { type: "task_complete" },
  });
  alerts.update([
    { ...codex, ...done },
    { ...claude, terminalId: undefined, state: "saved" },
  ]);
  assert.deepEqual(delivered.at(-1), {
    key: "Codex:same-id",
    provider: "Codex",
    sessionID: "same-id",
    title: "Codex is ready for review",
    body: "Codex work",
  });
});
