import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

function legacyPaths(interpreter, script, provider) {
  const bundle = "/Contents/Resources/python/bin/python3";
  if (!path.isAbsolute(interpreter) || !interpreter.endsWith("RunHuddle.app" + bundle)) return false;
  const app = interpreter.slice(0, -bundle.length);
  if (path.basename(app) !== "RunHuddle.app" ||
    script !== app + "/Contents/Resources/bridge/" + provider + "_bridge.py") return false;
  return !fs.existsSync(interpreter) || !fs.existsSync(script);
}

// The native installer wrote these paths using Python's shlex.join.
function unquotePath(token) {
  if (/^[\w@%+=:,./-]+$/.test(token)) return token;
  const value = token.slice(1, -1).replaceAll("'\"'\"'", "'");
  return token === "'" + value.replaceAll("'", "'\"'\"'") + "'" ? value : "";
}

function staleClaudeHook(hook, event) {
  if (hook?.type !== "command" || typeof hook.command !== "string") return false;
  const command = /^(.*?) -E -s -B (.*?) hook ([A-Za-z]+)$/.exec(hook.command);
  return command?.[3] === event &&
    legacyPaths(unquotePath(command[1]), unquotePath(command[2]), "claude");
}

function staleCopilotHook(hook, event) {
  const args = hook?.args;
  return hook?.type === "command" && typeof hook.exec === "string" &&
    Array.isArray(args) && args.length === 6 &&
    args[0] === "-E" && args[1] === "-s" && args[2] === "-B" &&
    args[4] === "hook" && args[5] === event && legacyPaths(hook.exec, args[3], "copilot");
}

function cleanHookFile(file, filter) {
  let settingsPath;
  try {
    settingsPath = fs.realpathSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  const previous = fs.readFileSync(settingsPath);
  const settings = JSON.parse(previous.toString("utf8"));
  const hooks = settings?.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return 0;

  let removed = 0;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const remaining = filter(entries, event, (count) => { removed += count; });
    if (remaining.length) hooks[event] = remaining;
    else if (entries.length) delete hooks[event];
  }
  if (!removed) return 0;

  const suffix = ".runhuddle-" + randomUUID();
  const temporary = settingsPath + suffix + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.writeFileSync(settingsPath + suffix + ".bak", previous, { mode: 0o600, flag: "wx" });
    if (!fs.readFileSync(settingsPath).equals(previous)) throw Error("Provider settings changed during hook cleanup");
    fs.renameSync(temporary, settingsPath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return removed;
}

export function removeLegacyHooks(env = process.env, onError = () => {}) {
  const claude = path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "settings.json");
  const copilot = path.join(env.COPILOT_HOME || path.join(os.homedir(), ".copilot"), "hooks", "agent-session-manager.json");
  const cleaners = [
    ["Claude", claude, (groups, event, countRemoved) => groups.flatMap((group) => {
      if (!Array.isArray(group?.hooks)) return [group];
      const hooks = group.hooks.filter((hook) => !staleClaudeHook(hook, event));
      const removed = group.hooks.length - hooks.length;
      if (!removed) return [group];
      countRemoved(removed);
      return hooks.length ? [{ ...group, hooks }] : [];
    })],
    ["Copilot", copilot, (entries, event, countRemoved) => {
      const remaining = entries.filter((hook) => !staleCopilotHook(hook, event));
      countRemoved(entries.length - remaining.length);
      return remaining;
    }],
  ];
  let removed = 0;
  for (const [provider, file, filter] of cleaners) {
    try {
      removed += cleanHookFile(file, filter);
    } catch (error) {
      onError(provider, error);
    }
  }
  return removed;
}
