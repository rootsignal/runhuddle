import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { createUpdateCheck, terminalUpdateBlocker } from "../main/app-updates.mjs";

function fixture({ packaged = true, latest, answers = [], installBlocker, transfer } = {}) {
  const calls = [];
  const messages = [];
  const progress = [];
  const updater = Object.assign(new EventEmitter(), {
    async checkForUpdates() {
      calls.push("check");
      return { isUpdateAvailable: !!latest, updateInfo: { version: latest } };
    },
    async downloadUpdate() { calls.push("download"); await transfer?.(updater); },
    quitAndInstall() { calls.push("install"); },
  });
  const check = createUpdateCheck({
    app: { isPackaged: packaged, getVersion: () => "0.1.0" },
    dialog: { async showMessageBox(options) {
      messages.push(options.message);
      return { response: answers.shift() ?? 0 };
    } },
    updater, windowForDialog: () => undefined, installBlocker, onDownloadProgress: (value) => progress.push(value),
  });
  return { check, calls, messages, progress, updater };
}

test("update checks ask before downloading and installing", async () => {
  const pending = fixture({ latest: "0.2.0", answers: [0, 1] });
  await pending.check();
  assert.deepEqual(pending.calls, ["check", "download"]);
  assert.equal(pending.updater.autoDownload, false);
  assert.equal(pending.updater.autoInstallOnAppQuit, false);
  const approved = fixture({ latest: "0.2.0", answers: [0, 0] });
  await approved.check();
  assert.deepEqual(approved.calls, ["check", "download", "install"]);
});

test("updates explain the install blocker and leave development builds offline", async () => {
  const blocked = fixture({ latest: "0.2.0", installBlocker: async () => "Wait for working agents to finish before installing." });
  await blocked.check();
  assert.deepEqual(blocked.calls, ["check", "download"]);
  assert.match(blocked.messages.at(-1), /working agents/);
  const development = fixture({ packaged: false });
  await development.check();
  assert.deepEqual(development.calls, []);
  const current = fixture();
  await current.check();
  assert.match(current.messages.at(-1), /up to date/);
});

test("a download reports initial progress and clears it before the completion or failure dialog", async () => {
  for (const fails of [false, true]) {
    const update = fixture({ latest: "0.2.0", answers: [0, 1], transfer(updater) {
      updater.emit("download-progress", { percent: 27.3 });
      updater.emit("download-progress", { percent: 27.4 });
      if (fails) throw Error("Download failed");
    } });
    await update.check();
    assert.deepEqual(update.progress, [
      { version: "0.2.0", percent: null }, { version: "0.2.0", percent: 27 }, null,
    ]);
    assert.match(update.messages.at(-1), fails ? /Couldn’t update/ : /ready to install/);
  }
});

test("macOS can update with idle agents and open shells while working agents block installation", () => {
  const terminal = { id: "agent", exited: false };
  const shell = { id: "shell", exited: false };
  const session = { terminalId: "agent", state: "idle" };
  assert.equal(terminalUpdateBlocker([terminal, shell], [session], "darwin"), "");
  assert.match(terminalUpdateBlocker([terminal, shell], [{ ...session, state: "working" }], "darwin"), /working agents/);
  assert.equal(terminalUpdateBlocker([{ ...terminal, exited: true }], [{ ...session, state: "working" }], "darwin"), "");
  assert.match(terminalUpdateBlocker([shell], [], "win32"), /open terminals/);
});
