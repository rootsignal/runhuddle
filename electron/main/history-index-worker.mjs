import { parentPort, workerData } from "node:worker_threads";
import { setImmediate } from "node:timers/promises";
import { HistoryIndex, historyKey } from "./history-index.mjs";

const index = new HistoryIndex(workerData);
const pending = new Map();
const checked = new Map();
let activeKey;
let draining = false;
let catalog;
let prunePending = false;
let notifyTimer;
let latestSearch;

function notify() {
  notifyTimer ??= setTimeout(() => {
    notifyTimer = undefined;
    parentPort.postMessage({ event: "updated" });
  }, 300);
}

function enqueue(session, forceCheck = false) {
  const key = historyKey(session);
  const signature = JSON.stringify([session.cwd, session.updated]);
  const previous = pending.get(key) || checked.get(key);
  if (previous?.signature === signature &&
      (!forceCheck || pending.has(key) || activeKey === key ||
        Date.now() - previous.at < 15000)) return;
  pending.set(key, { session, signature });
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (pending.size || prunePending) {
      await setImmediate();
      if (prunePending) {
        prunePending = false;
        index.prune(catalog);
      }
      const entry = pending.entries().next();
      if (entry.done) continue;
      const [key, { session, signature }] = entry.value;
      pending.delete(key);
      activeKey = key;
      const row = { signature, at: Date.now(), failed: false };
      checked.set(key, row);
      try {
        await index.sync(session);
      } catch {
        row.failed = true;
      }
      activeKey = undefined;
      notify();
    }
  } finally {
    draining = false;
  }
}

function runSearch(request) {
  if (latestSearch !== request) return;
  latestSearch = undefined;
  const { id, sessions, query, refresh } = request;
  if (refresh) {
    // The app may have missed changes from a CLI running outside RunHuddle.
    // Check those files when a user searches and prioritize their scope.
    const background = new Map(pending);
    pending.clear();
    for (const session of sessions) {
      const key = historyKey(session);
      const queued = background.get(key);
      if (queued) pending.set(key, queued);
      else enqueue(session, true);
    }
    for (const [key, row] of background)
      if (!pending.has(key)) pending.set(key, row);
  }
  const keys = sessions.map(historyKey);
  try {
    const result = index.search(sessions, query);
    parentPort.postMessage({
      id,
      result: {
        ...result,
        indexing: keys.some((key) => pending.has(key) || key === activeKey),
        incomplete: result.incomplete || keys.some((key) => checked.get(key)?.failed),
      },
    });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
  queueDrain();
}

function queueDrain() {
  void drain().catch((error) => queueMicrotask(() => { throw error; }));
}

parentPort.on("message", (request) => {
  if (request.cancel) {
    latestSearch = undefined;
    return;
  }
  if (request.id) {
    latestSearch = request;
    void setImmediate().then(() => runSearch(request));
    return;
  }
  if (request.prune) {
    const keys = new Set(request.sessions.map(historyKey));
    if (!catalog || catalog.size !== keys.size || [...catalog].some((key) => !keys.has(key)))
      prunePending = true;
    catalog = keys;
    for (const key of pending.keys()) if (!keys.has(key)) pending.delete(key);
    for (const key of checked.keys()) if (!keys.has(key)) checked.delete(key);
  }
  for (const session of request.sessions) enqueue(session);
  queueDrain();
});
