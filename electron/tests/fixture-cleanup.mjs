import fs from "node:fs";
import { execFileSync } from "node:child_process";

export function removeFixture(directory) {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    if (process.platform !== "win32" || error.code !== "EPERM") throw error;
    // Windows test fixtures can contain hidden directories and read-only files.
    execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "if (Test-Path -LiteralPath $env:RUNHUDDLE_TEST_FIXTURE) { Remove-Item -LiteralPath $env:RUNHUDDLE_TEST_FIXTURE -Recurse -Force -ErrorAction Stop }",
    ], { env: { ...process.env, RUNHUDDLE_TEST_FIXTURE: directory }, timeout: 15000 });
  }
}
