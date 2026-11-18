import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { validateID } from "./lifecycle.mjs";

const execute = promisify(execFile);
const knownApps = new Map([
  ["RunHuddle", "RunHuddle"],
  ["RunHuddle Preview", "RunHuddle"],
  ["ChatGPT", "ChatGPT"],
  ["Codex", "the Codex desktop app"],
  ["Proactive", "Proactive"],
  ["Terminal", "Terminal"],
  ["iTerm", "iTerm"],
  ["Visual Studio Code", "VS Code"],
]);

export async function codexLockOwner(sessionID) {
  if (process.platform === "win32" || !sessionID) return;
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const file = path.join(home, "thread-writer-locks", validateID(sessionID) + ".lock");
  try {
    const { stdout: candidates } = await execute("lsof", ["-t", "-nP", file], { timeout: 2000 });
    const pids = candidates.trim().split(/\s+/).filter((pid) => /^\d+$/.test(pid));
    if (new Set(pids).size !== 1) return;
    const { stdout } = await execute("ps", ["-axo", "pid=,ppid=,tty=,comm="], { timeout: 2000 });
    const processes = new Map();
    for (const line of stdout.split("\n")) {
      const entry = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (entry) processes.set(entry[1], { parent: entry[2], tty: entry[3], command: entry[4] });
    }
    let tty;
    for (let pid = pids[0], hops = 0; pid && hops < 20; hops++) {
      const process = processes.get(pid);
      if (!process) break;
      const app = process.command.match(/([^/]+)\.app\/Contents\//)?.[1];
      if (knownApps.has(app)) return knownApps.get(app);
      if (/^(?:ttys\d+|pts\/\d+)$/.test(process.tty)) tty ??= process.tty;
      pid = process.parent;
    }
    if (tty) return `a terminal (${tty})`;
  } catch {
    // The lock can disappear between attempts, and lsof is optional on Linux.
  }
}
