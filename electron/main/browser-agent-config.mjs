import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { address } from "./protocol.mjs";

export const browserAgentAddress = (directory) => address(path.join(directory, "browser-agent"));
const helper = fileURLToPath(new URL("./browser-agent-mcp.mjs", import.meta.url));
const server = "runhuddle_browser";

export function prepareBrowserAgent(agent, serviceDirectory) {
  const parent = path.join(serviceDirectory, "browser-agents");
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(parent, "session-"));
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  try {
    const key = randomBytes(32).toString("hex");
    const credentials = path.join(directory, "credentials.json");
    fs.writeFileSync(credentials, JSON.stringify({ endpoint: browserAgentAddress(serviceDirectory), key }), { mode: 0o600 });
    const args = [helper, credentials];
    const env = { ELECTRON_RUN_AS_NODE: "1" };
    let flags;
    if (agent === "codex") {
      const prefix = "mcp_servers." + server;
      const literal = (value) => process.platform === "win32" ? "'" + value + "'" : JSON.stringify(value);
      flags = [
        "-c", prefix + ".command=" + literal(process.execPath),
        "-c", prefix + ".args=[" + args.map(literal).join(",") + "]",
        "-c", prefix + ".env.ELECTRON_RUN_AS_NODE='1'",
      ];
    } else {
      const config = path.join(directory, "mcp.json");
      const spec = { type: agent === "copilot" ? "local" : "stdio", command: process.execPath, args, env };
      if (agent === "copilot") spec.tools = ["*"];
      fs.writeFileSync(config, JSON.stringify({ mcpServers: { [server]: spec } }), { mode: 0o600 });
      flags = agent === "copilot" ? ["--additional-mcp-config", "@" + config] : ["--mcp-config", config];
    }
    return { key, flags, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
