import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { shellLaunch, terminalEnvironment, quote } from "./lifecycle.mjs";

export function usageWindow(label, used, reset, now = Date.now()) {
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0 || used > 100) return null;
  const time = typeof reset === "number" ? reset * (reset < 1e12 ? 1000 : 1) : Date.parse(reset);
  if (!Number.isFinite(time) || time <= now) return null;
  return { label, remaining: Math.max(0, Math.floor(100 - used)), resetsAt: new Date(time).toISOString() };
}
export function parseCodexUsage(result, now = Date.now()) {
  const limits = result.rateLimitsByLimitId?.codex || result.rateLimits;
  if (!limits) throw Error("Codex did not report plan usage.");
  const windows = [limits.primary, limits.secondary].filter(Boolean).map(w =>
    usageWindow(w.windowDurationMins === 10080 ? "Weekly" : w.windowDurationMins === 300 ? "Five-hour" : w.windowDurationMins + "-minute", w.usedPercent, w.resetsAt, now)).filter(Boolean);
  return { provider: "codex", windows, checkedAt: new Date(now).toISOString(),
    credits: limits.credits?.balance || null,
    message: windows.length ? "" : "Codex did not report a current plan allowance." };
}
export function readCodexUsage() {
  return new Promise((resolve, reject) => {
    const launch = shellLaunch(["codex", "app-server", "--stdio"]);
    const child = spawn(launch.file, launch.args, { env: terminalEnvironment(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let buffer = "", done = false;
    const timer = setTimeout(() => finish(Error("Codex usage check timed out.")), 12000);
    function finish(error, result) {
      if (done) return;
      done = true; clearTimeout(timer); child.stdin.end(); child.kill();
      error ? reject(error) : resolve(result);
    }
    child.on("error", e => finish(e));
    child.on("exit", () => finish(Error("Codex usage is unavailable. Check its CLI login.")));
    child.stdin.on("error", e => finish(e)); child.stderr.resume();
    const send = message => child.stdin.write(JSON.stringify(message) + "\n");
    child.stdout.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return finish(Error("Unexpected usage response."));
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id !== 1 && m.id !== 2) continue;
        if (m.error) return finish(Error(m.error.message));
        if (m.id === 1) {
          send({ method: "initialized" });
          send({ id: 2, method: "account/rateLimits/read", params: {} });
        } else {
          try { finish(null, parseCodexUsage(m.result)); } catch (e) { finish(e); }
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "runhuddle_usage", version: "0.1.0" } } });
  });
}
export function claudeUsage(directory, now = Date.now()) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(directory, "claude-usage.json"), "utf8"));
    if (!data.checkedAt || !Number.isFinite(Date.parse(data.checkedAt)) || now - Date.parse(data.checkedAt) > 15 * 60 * 1000) throw Error("stale");
    const limits = data.rate_limits || {};
    const windows = [["Five-hour", limits.five_hour], ["Weekly", limits.seven_day]].map(([label, w]) =>
      w && usageWindow(label, w.used_percentage, w.resets_at, now)).filter(Boolean);
    return { provider: "claude", windows, checkedAt: data.checkedAt, message: windows.length ? "" : "Claude has not reported plan limits yet." };
  } catch {
    return { provider: "claude", windows: [], message: "No fresh Claude usage. Connect its status line, then use Claude to update it." };
  }
}
export function configureClaudeRelay(directory, enable, settingsFile = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "settings.json")) {
  if (process.platform === "win32") throw Error("Claude usage connection currently supports macOS and Linux.");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stateFile = path.join(directory, "claude-relay-state.json");
  const script = path.join(directory, "claude-usage-relay.cjs");
  const command = "ELECTRON_RUN_AS_NODE=1 " + quote(process.execPath) + " " + quote(script);
  let settings = {};
  if (fs.existsSync(settingsFile)) settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  const own = settings.statusLine?.command === command;
  if (!enable) {
    if (!own) throw Error("Claude's status line changed elsewhere; it was left untouched.");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (state.previous) settings.statusLine = state.previous; else delete settings.statusLine;
  } else if (!own) {
    fs.writeFileSync(stateFile, JSON.stringify({ previous: settings.statusLine || null }), { mode: 0o600 });
    const output = path.join(directory, "claude-usage.json");
    const previous = settings.statusLine?.command;
    // Store only quota windows, never the transcript or workspace data in status-line input.
    const source = `const fs=require("node:fs"),{spawn}=require("node:child_process");let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>{input+=c;if(input.length>1048576)process.exit(1)});process.stdin.on("end",()=>{try{const j=JSON.parse(input);const dest=${JSON.stringify(output)},tmp=dest+"."+process.pid;fs.writeFileSync(tmp,JSON.stringify({checkedAt:new Date().toISOString(),rate_limits:j.rate_limits||null}),{mode:384});fs.renameSync(tmp,dest)}catch{}const cmd=${JSON.stringify(previous || "")};if(cmd){const p=spawn(cmd,{shell:true,stdio:["pipe","inherit","inherit"]});p.stdin.on("error",()=>{});p.on("error",()=>{});p.stdin.end(input)}});`;
    fs.writeFileSync(script, source, { mode: 0o600 });
    settings.statusLine = { ...(settings.statusLine || {}), type: "command", command };
  } else return true;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temp = settingsFile + ".runhuddle-tmp";
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, settingsFile);
  return enable;
}
export function usageService(directory) {
  const cache = new Map();
  return async provider => {
    if (provider === "claude") return claudeUsage(directory);
    if (provider === "copilot") return { provider, windows: [], message: "Copilot AI-credit plan usage is not connected. Use /usage in Copilot for current limits." };
    if (provider !== "codex") return { provider, windows: [], message: "Usage is unavailable for this agent." };
    let entry = cache.get(provider);
    if (!entry || Date.now() - entry.at > 60000) {
      entry = { at: Date.now(), result: readCodexUsage().catch(e => ({ provider, windows: [], message: e.message })) };
      cache.set(provider, entry);
    }
    return entry.result;
  };
}
