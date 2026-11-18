import fs from "node:fs";
import { execFileSync } from "node:child_process";

export function removeGitFixture(directory) {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    if (process.platform !== "win32" || error.code !== "EPERM") throw error;
    // Git for Windows can leave hidden directories and read-only object files.
    execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "if (Test-Path -LiteralPath $env:RUNHUDDLE_GIT_FIXTURE) { Remove-Item -LiteralPath $env:RUNHUDDLE_GIT_FIXTURE -Recurse -Force -ErrorAction Stop }",
    ], { env: { ...process.env, RUNHUDDLE_GIT_FIXTURE: directory }, timeout: 15000 });
  }
}
