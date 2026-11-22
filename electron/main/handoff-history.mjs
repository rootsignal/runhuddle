import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { readHistory } from "./history.mjs";
import { transcriptLines } from "./history-search.mjs";
import { transcriptPath } from "./lifecycle.mjs";

const summaryLimit = 24000;

function summaryText(content) {
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.filter((item) => item?.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n")
    : "";
  const trimmed = text.trim();
  return trimmed.length > summaryLimit ? trimmed.slice(0, summaryLimit - 1) + "…" : trimmed;
}

async function readCheckpointFile(directory, name) {
  const file = await fs.open(path.join(directory, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await file.stat()).isFile()) return "";
    const buffer = Buffer.alloc(summaryLimit * 4);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await file.close();
  }
}

async function latestCopilotCheckpoint(file) {
  const directory = path.join(path.dirname(file), "checkpoints");
  try {
    const index = await readCheckpointFile(directory, "index.md");
    const rows = [...index.matchAll(/^\s*\|\s*(\d+)\s*\|[^\n]*\]\((?:\.\/)?([\w.-]+\.md)\)\s*\|/gm)];
    const latest = rows.sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    if (latest && latest[2] !== "index.md") return summaryText(await readCheckpointFile(directory, latest[2]));
  } catch {
    // Some sessions expose an event summary without a local checkpoint.
  }
}

async function readCompactionSummary(provider, file) {
  let summary;
  for await (const { line } of transcriptLines(file)) {
    if (!line || (!line.includes('"compacted"') && !line.includes('"isCompactSummary"') &&
        !line.includes('"session.compaction_complete"'))) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (provider === "codex" && event?.type === "compacted") {
      summary = summaryText(event.payload?.message);
    } else if (provider === "claude" && event?.type === "user" && event.isCompactSummary === true && !event.isSidechain) {
      summary = summaryText(event.message?.content);
    } else if (provider === "copilot" && event?.type === "session.compaction_complete" && !event.agentId && event.data?.success === true) {
      summary = summaryText(event.data.summaryContent);
    }
  }
  return summary || (provider === "copilot" ? await latestCopilotCheckpoint(file) : undefined) || undefined;
}

export async function readHandoffHistory(session) {
  const provider = session.provider.toLowerCase();
  const history = await readHistory(session);
  const file = transcriptPath(provider, session.sessionID, session.cwd);
  if (!file || history.unavailable) return history;
  const compactionSummary = await readCompactionSummary(provider, file).catch(() => undefined);
  return { ...history, compactionSummary };
}
