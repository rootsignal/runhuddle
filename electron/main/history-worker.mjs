import { parentPort, workerData } from "node:worker_threads";
import { readAttentionPreview, readHistory } from "./history.mjs";
import { readHistoryAround, searchHistory } from "./history-search.mjs";

try {
  const { session, sessions, query, anchor, attentionKind, includeTurns } = workerData;
  const result = sessions
    ? await searchHistory(sessions, query)
    : attentionKind
      ? await readAttentionPreview(session, attentionKind, includeTurns)
      : anchor
        ? await readHistoryAround(session, anchor)
        : await readHistory(session);
  parentPort.postMessage({ result });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
