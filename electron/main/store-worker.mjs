import { parentPort, workerData } from "node:worker_threads";
import { readStore } from "./store.mjs";
try {
  parentPort.postMessage({ result: readStore(workerData) });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
