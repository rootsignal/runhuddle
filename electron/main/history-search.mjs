import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { historyMessage } from "./history.mjs";
import { transcriptPath } from "./lifecycle.mjs";

const maxLine = 4 * 1024 * 1024;
const contextBytes = 512 * 1024;
export const resultLimit = 40;

export async function* transcriptLines(
  file, start = 0, end, exactStart = false,
) {
  let parts = [],
    size = 0,
    offset = start,
    skip = start > 0 && !exactStart;
  const stream = typeof file === "string"
    ? createReadStream(file, { start, end })
    : file.createReadStream({ start, end, autoClose: false });
  for await (const chunk of stream) {
    let cursor = 0;
    while (cursor < chunk.length) {
      const newline = chunk.indexOf(10, cursor);
      const last = newline < 0 ? chunk.length : newline;
      const bytes = chunk.subarray(cursor, last);
      size += bytes.length;
      if (!skip && size <= maxLine) parts.push(bytes);
      else parts = [];
      cursor = last + 1;
      if (newline < 0) break;
      if (parts.length || exactStart)
        yield {
          offset,
          nextOffset: offset + size + 1,
          line: parts.length ? Buffer.concat(parts, size).toString("utf8") : undefined,
        };
      offset += size + 1;
      parts = [];
      size = 0;
      skip = false;
    }
  }
  if (parts.length)
    yield { offset, nextOffset: offset, line: Buffer.concat(parts, size).toString("utf8") };
}

export const fingerprint = (line) =>
  createHash("sha256").update(line).digest("hex").slice(0, 24);

export function historyMatch(session, message, words, offset, hash) {
  const text = message.text.replace(/\s+/g, " ").trim();
  const folded = text.toLowerCase();
  const indices = words.map((word) => folded.indexOf(word));
  if (indices.some((value) => value < 0)) return;
  const start = Math.max(0, Math.min(...indices) - 55);
  const end = start + 170;
  return {
    provider: session.provider,
    sessionID: session.sessionID,
    title: session.title,
    snippet: (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : ""),
    anchor: {
      offset,
      fingerprint: typeof hash === "function" ? hash() : hash,
      textOffset: Math.max(0, message.text.toLowerCase().indexOf(words[0])),
    },
  };
}

export async function searchHistory(sessions, query) {
  const words = [...new Set(query.toLowerCase().trim().split(/\s+/))];
  const results = [];
  const deadline = Date.now() + 12000;
  let incomplete = false;
  for (const session of sessions) {
    if (Date.now() >= deadline || results.length >= resultLimit) {
      incomplete = true;
      break;
    }
    const agent = session.provider.toLowerCase();
    try {
      const file = transcriptPath(agent, session.sessionID, session.cwd);
      if (!file) continue;
      let match;
      for await (const { offset, line } of transcriptLines(file)) {
        if (Date.now() >= deadline) {
          incomplete = true;
          break;
        }
        const message = historyMessage(agent, line);
        if (!message) continue;
        match = historyMatch(session, message, words, offset, () => fingerprint(line));
        if (match) break;
      }
      if (match) results.push(match);
    } catch (error) {
      if (error.code !== "ENOENT") incomplete = true;
    }
  }
  return { results, incomplete };
}

export async function readHistoryAround(session, anchor) {
  const agent = session.provider.toLowerCase();
  const file = transcriptPath(agent, session.sessionID, session.cwd);
  if (!file) return { messages: [], truncated: true, matchMissing: true };
  const messages = [];
  let found = false;
  let after = 0;
  try {
    for await (const { offset, line } of transcriptLines(
      file,
      Math.max(0, anchor.offset - contextBytes),
      anchor.offset + maxLine + contextBytes,
    )) {
      if (!found && offset > anchor.offset) break;
      const message = historyMessage(agent, line);
      if (!message) continue;
      const match =
        offset === anchor.offset && fingerprint(line) === anchor.fingerprint;
      if (match) found = true;
      const { fallback, ...row } = message;
      const previous = messages.at(-1);
      if (
        agent === "codex" &&
        previous?.role === row.role &&
        previous.text === row.text
      ) {
        if (match) previous.match = true;
        continue;
      }
      const start =
        match && anchor.textOffset >= 60000
          ? Math.max(0, anchor.textOffset - 500)
          : 0;
      messages.push({
        ...row,
        text: (start ? "…" : "") + row.text.slice(start, start + 60000),
        match,
      });
      if (!found && messages.length > 8) messages.shift();
      if (found && !match && ++after >= 8) break;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    messages: found ? messages : [],
    truncated: true,
    matchMissing: !found,
  };
}
