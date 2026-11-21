import { screenshotReferences } from "./dashboard-follow-up.mjs";
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
const transcriptTailBytes = 4 * 1024 * 1024;

async function transcriptTail(session, maxBytes = transcriptTailBytes) {
  const file = transcriptPath(session.provider.toLowerCase(), session.sessionID, session.cwd);
  if (!file) return { source: "", truncated: false, unavailable: true };
  let handle;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    const truncated = stat.size > length;
    const source = buffer.toString("utf8");
    return { source: truncated ? source.slice(source.indexOf("\n") + 1) : source, truncated };
  } catch (e) {
    if (e.code === "ENOENT") return { source: "", truncated: false, unavailable: true };
    throw e;
  } finally {
    await handle?.close();
  }
}

export async function readHistory(session) {
  const { source, truncated, unavailable } = await transcriptTail(session);
  const messages = parseHistory(session.provider.toLowerCase(), source);
  return { messages, truncated: truncated || messages.length >= 250, ...(unavailable ? { unavailable } : {}) };
}

function questions(input) {
  if (typeof input === "string") {
    try { input = JSON.parse(input); } catch { return []; }
  }
  const items = Array.isArray(input?.questions) ? input.questions : [input];
  return items.flatMap((item) => {
    if (typeof item?.question !== "string" || !item.question.trim()) return [];
    const options = item.options ?? item.choices;
    const choices = Array.isArray(options) ? options.flatMap((option) => {
      const label = typeof option === "string" ? option : option?.label;
      return typeof label === "string" && label.trim() ? [label.trim().slice(0, 120)] : [];
    }).slice(0, 8) : [];
    return [{ text: item.question.trim().slice(0, 400), choices }];
  }).slice(0, 5);
}

export function pendingQuestions(agent, source) {
  const pending = new Map();
  for (const line of source.split("\n")) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== "object") continue;
    const payload = event.payload || event.data || {};
    if (agent === "codex") {
      if (event.type === "event_msg" && ["task_started", "task_complete", "turn_aborted"].includes(payload.type))
        pending.clear();
      if (event.type === "response_item" && payload.call_id) {
        if (payload.type === "function_call" && payload.name === "request_user_input")
          pending.set(payload.call_id, questions(payload.arguments));
        if (payload.type === "function_call_output") pending.delete(payload.call_id);
      }
    } else if (agent === "claude" && !event.isSidechain && !event.isMeta) {
      const content = event.message?.content;
      if (event.type === "user" && typeof content === "string" && content.trim()) pending.clear();
      if (event.type === "assistant" && event.message?.stop_reason === "end_turn") pending.clear();
      if (Array.isArray(content)) for (const part of content) {
        if (event.type === "assistant" && part?.type === "tool_use" && part.name === "AskUserQuestion" && part.id)
          pending.set(part.id, questions(part.input));
        if (event.type === "user" && part?.type === "tool_result") pending.delete(part.tool_use_id);
        if (event.type === "user" && part?.type === "text" && typeof part.text === "string" && part.text.trim()) pending.clear();
      }
    } else if (agent === "copilot" && !event.agentId) {
      if (["user.message", "session.idle", "session.error", "session.resume"].includes(event.type)) pending.clear();
      if (event.type === "user_input.requested")
        pending.set("request:" + (payload.requestId || ""), questions(payload));
      if (event.type === "user_input.completed") pending.delete("request:" + (payload.requestId || ""));
      if (event.type === "tool.execution_start" && payload.toolName === "ask_user" && payload.toolCallId)
        pending.set("tool:" + payload.toolCallId, questions(payload.arguments));
      if (event.type === "tool.execution_complete") pending.delete("tool:" + payload.toolCallId);
    }
  }
  const unique = new Map();
  for (const group of pending.values()) for (const question of group) unique.set(question.text, question);
  return [...unique.values()].slice(0, 5);
}

function previewTurn(messages, turnStart, end) {
  const rawInstruction = messages[turnStart]?.text ?? "";
  const imageTags = /<image\b(?=[^>]*\bpath\s*=)[^>]*>(?:\s*<\/image>)?/gi;
  const references = rawInstruction.match(screenshotReferences)?.[0] ?? "";
  const screenshots = [...rawInstruction.matchAll(imageTags)].length + (references.match(/^- "/gm)?.length ?? 0);
  const instruction = screenshots
    ? rawInstruction.replace(screenshotReferences, "").replace(imageTags, "").replace(/\[Image #\d+\]\s*/gi, "").trim()
    : rawInstruction.trim();
  const answer = messages.slice(turnStart + 1, end).findLast((message) => message.role === "assistant")?.text.trim();
  const opening = answer?.split(/\n[ \t]*\n/, 1)[0].replace(/\s+/g, " ");
  const clip = (text, limit) => text && (text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text);
  return {
    instruction: clip(instruction, 240),
    screenshots,
    instructionAt: Date.parse(messages[turnStart]?.time || "") || undefined,
    update: clip(opening, 280),
    answer: answer?.slice(0, 12000),
    truncated: (answer?.length ?? 0) > 12000,
  };
}

export async function readAttentionPreview(session, kind, includeTurns = false) {
  const agent = session.provider.toLowerCase();
  let tail = await transcriptTail(session);
  let messages = parseHistory(agent, tail.source);
  const turnStarts = () => messages.flatMap((message, index) => message.role === "user" ? [index] : []).slice(-5);
  let starts = turnStarts();
  // Large Codex tool results can push the active instruction and recent turns
  // out of the normal tail. Keep permission questions scoped to recent events.
  const questions = kind === "input" ? pendingQuestions(agent, tail.source) : undefined;
  if (agent === "codex") {
    for (const multiplier of [4, 8]) {
      if (!tail.truncated || starts.length >= (includeTurns ? 5 : 1)) break;
      tail = await transcriptTail(session, multiplier * transcriptTailBytes);
      messages = parseHistory(agent, tail.source);
      starts = turnStarts();
    }
  }
  const start = starts.at(-1) ?? -1;
  const turn = previewTurn(messages, start, messages.length);
  return {
    ...turn,
    questions,
    ...(includeTurns ? {
      recentTurns: starts.map((index, position) => position === starts.length - 1 ? turn : previewTurn(messages, index, starts[position + 1])),
    } : {}),
  };
}
