import { parentPort, workerData } from "node:worker_threads";
import { readAttentionPreview, readHistory } from "./history.mjs";
import { readHistoryAround, searchHistory } from "./history-search.mjs";

try {
  const { session, sessions, query, anchor, attentionKind } = workerData;
  const result = sessions
    ? await searchHistory(sessions, query)
    : attentionKind
      ? await readAttentionPreview(session, attentionKind)
      : anchor
        ? await readHistoryAround(session, anchor)
        : await readHistory(session);
  parentPort.postMessage({ result });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
