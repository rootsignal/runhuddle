import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

const providerHome = path.join(os.tmpdir(), "runhuddle-test-providers-" + randomUUID());
process.env.CODEX_HOME = path.join(providerHome, "codex");
process.env.CLAUDE_CONFIG_DIR = path.join(providerHome, "claude");
process.env.COPILOT_HOME = path.join(providerHome, "copilot");
export default defineConfig({
  testDir: "./tests/ui",
  timeout: 30000,
  workers: 1,
  use: { trace: "retain-on-failure" },
});
