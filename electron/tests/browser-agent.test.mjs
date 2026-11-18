import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareBrowserAgent } from "../main/browser-agent-config.mjs";

test("each agent gets a launch-scoped Browser adapter, with distinct credentials and cleanup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rh-browser-config-"));
  try {
    const grants = ["codex", "claude", "copilot"].map((agent) => prepareBrowserAgent(agent, directory));
    assert.equal(new Set(grants.map(({ key }) => key)).size, 3);
    const [codex, claude, copilot] = grants;
    assert.match(codex.flags.join(" "), /mcp_servers\.runhuddle_browser\.command/);
    assert.equal(claude.flags[0], "--mcp-config");
    assert.equal(copilot.flags[0], "--additional-mcp-config");
    for (const [grant, file, type] of [
      [claude, claude.flags[1], "stdio"],
      [copilot, copilot.flags[1].slice(1), "local"],
    ]) {
      const spec = JSON.parse(fs.readFileSync(file, "utf8")).mcpServers.runhuddle_browser;
      assert.equal(spec.type, type);
      assert.equal(JSON.parse(fs.readFileSync(spec.args[1], "utf8")).key, grant.key);
      const requests = [
        { id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } },
        { id: 2, method: "tools/list" },
      ];
      const output = execFileSync(spec.command, spec.args, {
        encoding: "utf8",
        env: { ...process.env, ...spec.env },
        input: requests.map((request) => JSON.stringify({ jsonrpc: "2.0", ...request }) + "\n").join(""),
      });
      const [info, listing] = output.trim().split("\n").map(JSON.parse);
      assert.equal(info.result.protocolVersion, "2025-11-25");
      assert.deepEqual(listing.result.tools.map(({ name }) => name),
        ["inspect_page", "screenshot", "click", "type_text", "reload"]);
    }
    for (const grant of grants) grant.cleanup();
    assert.deepEqual(fs.readdirSync(path.join(directory, "browser-agents")), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
