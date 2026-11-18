import test from "node:test";
import assert from "node:assert/strict";
import { detectEditors, editorCommand, editorService } from "../main/editors.mjs";
test("editor detection lists only installed apps without selecting one", () => {
  const rows = detectEditors("darwin", {}, p => ["/Applications/Cursor.app", "/Applications/Visual Studio Code.app"].includes(p));
  assert.deepEqual(rows.map(e => e.id), ["code", "cursor"]);
});
test("editor arguments preserve literal filenames and line positions", () => {
  const editor = { id: "code", application: "/usr/bin/code" };
  assert.deepEqual(editorCommand(editor, "/tmp/a $file.txt", 7, "linux"),
    { command: "/usr/bin/code", args: ["--goto", "/tmp/a $file.txt:7"] });
  assert.deepEqual(editorCommand({ id: "custom", application: "/opt/editor" }, "/tmp/folder", undefined, "linux").args, ["/tmp/folder"]);
});


test("custom editor preference persists across service restarts", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-editor-"));
  try {
    const application = path.join(dir, "editor");
    fs.writeFileSync(application, "");
    const settings = path.join(dir, "settings.json");
    editorService(settings).save({ id: "custom", name: "My editor", application });
    assert.equal(editorService(settings).list().preferred, "custom");
    fs.unlinkSync(application);
    assert.equal(editorService(settings).list().preferred, "");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
