import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { removeLegacyHooks } from "../main/legacy-hooks.mjs";

const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const shellPath = (file) => "'" + file.replaceAll("'", "'\"'\"'") + "'";

test("cleanup backs up provider settings and removes only missing native RunHuddle hooks", { skip: process.platform === "win32" }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "runhuddle-legacy-hooks-"));
  try {
    const env = {
      CLAUDE_CONFIG_DIR: path.join(directory, "claude"),
      COPILOT_HOME: path.join(directory, "copilot"),
    };
    const claudePath = path.join(env.CLAUDE_CONFIG_DIR, "settings.json");
    const copilotPath = path.join(env.COPILOT_HOME, "hooks", "agent-session-manager.json");
    for (const file of [claudePath, copilotPath]) fs.mkdirSync(path.dirname(file), { recursive: true });

    const resources = path.join(directory, "Old Mac's Apps", "RunHuddle.app", "Contents", "Resources");
    const installed = path.join(directory, "Native copy", "RunHuddle.app", "Contents", "Resources");
    const interpreter = (root) => path.join(root, "python", "bin", "python3");
    const bridge = (root, provider) => path.join(root, "bridge", provider + "_bridge.py");
    for (const file of [interpreter(installed), bridge(installed, "claude")]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "");
    }

    const claude = (event, root = resources) => ({
      type: "command",
      command: `${shellPath(interpreter(root))} -E -s -B ${shellPath(bridge(root, "claude"))} hook ${event}`,
      timeout: 3,
    });
    const otherHook = { type: "command", command: "echo custom" };
    const installedHook = claude("SessionStart", installed);
    const claudeSettings = {
      permissions: { allow: ["Read"] },
      hooks: {
        SessionStart: [{ matcher: "startup", hooks: [claude("SessionStart"), otherHook, installedHook] }],
        UserPromptSubmit: [{ hooks: [claude("UserPromptSubmit")] }],
        PreToolUse: [{ matcher: "Bash", hooks: [claude("PreToolUse")] }, { matcher: "Read", hooks: [otherHook] }],
      },
    };
    const copilotSettings = {
      version: 1,
      hooks: {
        sessionStart: [{
          type: "command",
          exec: interpreter(resources),
          args: ["-E", "-s", "-B", bridge(resources, "copilot"), "hook", "sessionStart"],
        }, otherHook],
      },
    };
    write(claudePath, claudeSettings);
    write(copilotPath, copilotSettings);

    assert.equal(removeLegacyHooks(env, (provider, error) => assert.fail(provider + ": " + error)), 4);
    assert.deepEqual(read(claudePath), {
      ...claudeSettings,
      hooks: {
        SessionStart: [{ matcher: "startup", hooks: [otherHook, installedHook] }],
        PreToolUse: [{ matcher: "Read", hooks: [otherHook] }],
      },
    });
    assert.deepEqual(read(copilotPath), { version: 1, hooks: { sessionStart: [otherHook] } });
    for (const [file, original] of [[claudePath, claudeSettings], [copilotPath, copilotSettings]]) {
      const backups = fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith(".bak"));
      assert.equal(backups.length, 1);
      const backup = path.join(path.dirname(file), backups[0]);
      assert.deepEqual(read(backup), original);
      assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
    }
    assert.equal(removeLegacyHooks(env), 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
