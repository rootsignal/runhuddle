import { parentPort, workerData } from "node:worker_threads";
import { readHistory } from "./history.mjs";
import { readHistoryAround, searchHistory } from "./history-search.mjs";

try {
  const { session, sessions, query, anchor } = workerData;
  const result = sessions
    ? await searchHistory(sessions, query)
    : anchor
      ? await readHistoryAround(session, anchor)
      : await readHistory(session);
  parentPort.postMessage({ result });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
