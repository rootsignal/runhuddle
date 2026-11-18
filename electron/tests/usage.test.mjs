import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCodexUsage, usageWindow, claudeUsage, configureClaudeRelay } from "../main/usage.mjs";
test("quota uses reported windows, rejects expired/invalid data and separates credits", () => {
  const now = Date.now(), resetsAt = Math.floor(now / 1000) + 3600;
  const usage = parseCodexUsage({ rateLimits: { primary: { usedPercent: 91, windowDurationMins: 10080, resetsAt }, credits: { balance: "62500" } } }, now);
  assert.equal(usage.windows[0].label, "Weekly");
  assert.equal(usage.windows[0].remaining, 9);
  assert.equal(usage.credits, "62500");
  assert.equal(usageWindow("Weekly", NaN, resetsAt, now), null);
  assert.equal(usageWindow("Weekly", 95, resetsAt - 7200, now), null);
  assert.equal(usageWindow("Weekly", 0, null, now), null);
});
test("Claude relay preserves settings and previous status line; stale data cannot warn", () => {
  if (process.platform === "win32") return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-usage-"));
  try {
    const settings = path.join(dir, "settings.json");
    const original = { other: true, statusLine: { type: "command", command: "echo existing", padding: 2 } };
    fs.writeFileSync(settings, JSON.stringify(original));
    configureClaudeRelay(dir, true, settings);
    assert.equal(JSON.parse(fs.readFileSync(settings)).other, true);
    configureClaudeRelay(dir, true, settings);
    configureClaudeRelay(dir, false, settings);
    assert.deepEqual(JSON.parse(fs.readFileSync(settings)), original);
    fs.writeFileSync(path.join(dir, "claude-usage.json"), JSON.stringify({
      checkedAt: new Date().toISOString(),
      rate_limits: { seven_day: { used_percentage: 93, resets_at: Date.now() / 1000 + 3600 } }
    }));
    assert.equal(claudeUsage(dir).windows[0].remaining, 7);
    assert.equal(claudeUsage(dir, Date.now() + 16 * 60 * 1000).windows.length, 0);
    configureClaudeRelay(dir, true, settings);
    fs.writeFileSync(settings, JSON.stringify({ statusLine: { command: "changed elsewhere" } }));
    assert.throws(() => configureClaudeRelay(dir, false, settings), /left untouched/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
