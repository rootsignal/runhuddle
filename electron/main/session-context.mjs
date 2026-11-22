import fs from "node:fs/promises";
import { transcriptPath } from "./lifecycle.mjs";

const cache = new Map();

async function scan(file, previous) {
  const handle = await fs.open(file, "r");
  try {
    const { dev, ino, size, mtimeMs } = await handle.stat();
    const sameFile = previous?.dev === dev && previous.ino === ino && previous.size <= size &&
      (previous.size !== size || previous.mtimeMs === mtimeMs);
    const state = sameFile ? { ...previous, size, mtimeMs }
      : { dev, ino, size, mtimeMs, offset: 0, startedAt: undefined, compactions: 0 };
    if (state.offset === size || (sameFile && previous.size === size)) return state;

    let pending = "";
    const stream = handle.createReadStream({ start: state.offset, end: size - 1, autoClose: false, encoding: "utf8" });
    for await (const chunk of stream) {
      pending += chunk;
      const end = pending.lastIndexOf("\n");
      if (end === -1) continue;
      const complete = pending.slice(0, end + 1);
      pending = pending.slice(end + 1);
      state.offset += Buffer.byteLength(complete);
      for (const line of complete.slice(0, -1).split("\n")) {
        if (!line.includes('"compacted"') && !line.includes('"session_meta"')) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event?.type === "session_meta" && state.startedAt === undefined) {
          const time = Date.parse(event.payload?.timestamp ?? event.timestamp);
          if (Number.isFinite(time)) state.startedAt = time;
        }
        // The rollout record represents one compaction. Ignore mentions and
        // event messages that can accompany the same compaction.
        if (event?.type === "compacted") state.compactions++;
      }
    }
    return state;
  } finally {
    await handle.close();
  }
}

export async function readSessionContext(session) {
  if (session.provider.toLowerCase() !== "codex" || !session.sessionID) return;
  const file = transcriptPath("codex", session.sessionID, session.cwd);
  if (!file) return;
  const previous = cache.get(file);
  const reading = previous?.reading ?? scan(file, previous?.state);
  if (!previous?.reading) {
    cache.delete(file);
    cache.set(file, { reading });
    if (cache.size > 32) cache.delete(cache.keys().next().value);
  }
  try {
    const state = await reading;
    if (cache.get(file)?.reading === reading) cache.set(file, { state });
    if (!state.offset) return;
    return {
      startedAt: state.startedAt,
      compactions: state.compactions,
    };
  } catch (error) {
    if (cache.get(file)?.reading === reading) cache.delete(file);
    if (error.code !== "ENOENT") throw error;
  }
}
