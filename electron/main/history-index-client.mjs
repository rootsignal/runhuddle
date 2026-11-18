import { Worker } from "node:worker_threads";

export function historyIndexClient(database, onUpdated) {
  let worker;
  let disabled = false;
  let request;
  let nextID = 0;

  function finish(result, error) {
    if (!request) return;
    const { timer, resolve, reject } = request;
    request = undefined;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(result);
  }

  function disable(error) {
    disabled = true;
    const current = worker;
    worker = undefined;
    finish(undefined, error);
    return current?.terminate();
  }

  function start() {
    if (disabled || worker) return worker;
    try {
      worker = new Worker(new URL("./history-index-worker.mjs", import.meta.url), {
        workerData: database,
      });
    } catch (error) {
      disable(error);
      return;
    }
    worker.on("message", (message) => {
      if (message.event === "updated") onUpdated();
      else if (message.id === request?.id)
        finish(message.result, message.error && Error(message.error));
    });
    worker.on("error", disable);
    worker.on("exit", () => disable(Error("History index stopped")));
    return worker;
  }

  return {
    sync(sessions, prune) {
      start()?.postMessage({ sessions, prune });
    },
    search(sessions, query, refresh) {
      const current = start();
      if (!current) return undefined;
      const id = ++nextID;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => disable(Error("History index timed out")), 12000);
        request = { id, timer, resolve, reject };
        current.postMessage({ id, sessions, query, refresh });
      });
    },
    cancel() {
      if (!request) return;
      worker?.postMessage({ cancel: true });
      finish({ results: [], incomplete: false });
    },
    close() {
      return disable();
    },
  };
}
