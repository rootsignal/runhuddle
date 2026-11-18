import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { createUpdateCheck } from "../main/app-updates.mjs";

function fixture({ packaged = true, latest, answers = [], canInstall } = {}) {
  const calls = [];
  const messages = [];
  const updater = Object.assign(new EventEmitter(), {
    async checkForUpdates() {
      calls.push("check");
      return { isUpdateAvailable: !!latest, updateInfo: { version: latest } };
    },
    async downloadUpdate() { calls.push("download"); },
    quitAndInstall() { calls.push("install"); },
  });
  const check = createUpdateCheck({
    app: { isPackaged: packaged, getVersion: () => "0.1.0" },
    dialog: { async showMessageBox(options) {
      messages.push(options.message);
      return { response: answers.shift() ?? 0 };
    } },
    updater, windowForDialog: () => undefined, canInstall,
  });
  return { check, calls, messages, updater };
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

test("updates wait for running terminals and leave development builds offline", async () => {
  const blocked = fixture({ latest: "0.2.0", canInstall: async () => false });
  await blocked.check();
  assert.deepEqual(blocked.calls, ["check", "download"]);
  assert.match(blocked.messages.at(-1), /Finish running sessions/);
  const development = fixture({ packaged: false });
  await development.check();
  assert.deepEqual(development.calls, []);
  const current = fixture();
  await current.check();
  assert.match(current.messages.at(-1), /up to date/);
});
