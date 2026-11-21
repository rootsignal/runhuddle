import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { turnCaptureStore } from "../main/turn-captures.mjs";

test("completed turn captures survive a restart and retain the latest five per session", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runhuddle-turn-captures-"));
  try {
    const file = path.join(dir, "turn-captures.json");
    const store = turnCaptureStore(file);
    const capture = { instructionAt: 1, root: dir,
      files: [{ file: { path: "readme.md", status: "M", area: "unstaged" }, diff: "+Example" }] };
    store.save("Claude:other", capture);
    for (let instructionAt = 1; instructionAt <= 6; instructionAt++) {
      store.save("Codex:fixture", { ...capture, instructionAt });
    }
    const restored = turnCaptureStore(file).list();
    assert.deepEqual(restored["Codex:fixture"].map((item) => item.instructionAt), [6, 5, 4, 3, 2]);
    assert.deepEqual(restored["Claude:other"], [capture]);
    assert.throws(() => store.save("Codex:fixture", { ...capture, files: [{
      file: { path: "../outside", status: "M", area: "unstaged" }, diff: "+Outside",
    }] }), /Invalid turn capture/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
