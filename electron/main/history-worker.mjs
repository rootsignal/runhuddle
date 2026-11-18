import { parentPort, workerData } from "node:worker_threads";
import { readHistory } from "./history.mjs";
try {
  parentPort.postMessage({ result: await readHistory(workerData) });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
