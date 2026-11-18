import fs from "node:fs/promises";
import { transcriptPath } from "./lifecycle.mjs";
const text = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter(
            (p) =>
              ["text", "input_text", "output_text"].includes(p?.type) &&
              typeof p.text === "string",
          )
          .map((p) => p.text)
          .join("\n")
      : "";
export function historyMessage(agent, line) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  if (!e || typeof e !== "object") return;
  let role,
    body,
    fallback = false;
  const p = e.payload || e.data || {};
  if (agent === "codex") {
    if (
      e.type === "event_msg" &&
      ["user_message", "agent_message"].includes(p.type)
    ) {
      role = p.type === "user_message" ? "user" : "assistant";
      body = p.message;
    } else if (
      e.type === "response_item" &&
      p.type === "message" &&
      ["user", "assistant"].includes(p.role)
    ) {
      role = p.role;
      body = text(p.content);
      fallback = true;
    }
  } else if (
    agent === "claude" &&
    !e.isSidechain &&
    !e.isMeta &&
    ["user", "assistant"].includes(e.type)
  ) {
    role = e.type;
    body = text(e.message?.content);
  } else if (
    agent === "copilot" &&
    !e.agentId &&
    ["user.message", "assistant.message"].includes(e.type)
  ) {
    role = e.type.startsWith("user") ? "user" : "assistant";
    body = text(p.content);
  }
  if (role && typeof body === "string" && body.trim())
    return { role, text: body, time: e.timestamp || "", fallback };
}

export function parseHistory(agent, source) {
  const messages = [];
  const fallback = [];
  for (const line of source.split("\n")) {
    const message = historyMessage(agent, line);
    if (!message) continue;
    const { fallback: secondary, ...row } = message;
    (secondary ? fallback : messages).push(row);
  }
  // Codex records the same messages in two event streams.
  const rows = messages.length ? messages : fallback;
  return rows.slice(-250).map((m) => ({ ...m, text: m.text.slice(0, 60000) }));
}
export async function readHistory(session) {
  const agent = session.provider.toLowerCase();
  const file = transcriptPath(agent, session.sessionID, session.cwd);
  if (!file) return { messages: [], truncated: false };
  let handle;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    const length = Math.min(stat.size, 4 * 1024 * 1024);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    let source = buffer.toString("utf8");
    if (stat.size > length) source = source.slice(source.indexOf("\n") + 1);
    const messages = parseHistory(agent, source);
    return {
      messages,
      truncated: stat.size > length || messages.length >= 250,
    };
  } catch (e) {
    if (e.code === "ENOENT") return { messages: [], truncated: false };
    throw e;
  } finally {
    await handle?.close();
  }
}
