import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const catalog = [
  ["code", "VS Code", "Visual Studio Code"],
  ["cursor", "Cursor", "Cursor"],
  ["windsurf", "Windsurf", "Windsurf"],
  ["zed", "Zed", "Zed"],
  ["subl", "Sublime Text", "Sublime Text"],
];
export function detectEditors(platform = process.platform, env = process.env, exists = fs.existsSync) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const rows = [];
  for (const [id, name, bundle] of catalog) {
    let candidates;
    if (platform === "darwin") candidates = ["/Applications", paths.join(os.homedir(), "Applications")].map(p => paths.join(p, bundle + ".app"));
    else if (platform === "win32") candidates = [
      paths.join(env.LOCALAPPDATA || "", "Programs", id === "code" ? "Microsoft VS Code" : bundle, id === "code" ? "Code.exe" : name + ".exe"),
      paths.join(env.ProgramFiles || "", id === "code" ? "Microsoft VS Code" : bundle, id === "code" ? "Code.exe" : name + ".exe"),
      ...(env.PATH || "").split(paths.delimiter).map(p => paths.join(p, id + ".exe")),
    ];
    else candidates = (env.PATH || "/usr/local/bin:/usr/bin").split(paths.delimiter).map(p => paths.join(p, id));
    const application = candidates.find(p => paths.isAbsolute(p) && exists(p));
    if (application) rows.push({ id, name, application });
  }
  return rows;
}
export function editorCommand(editor, target, line, platform = process.platform) {
  const position = Number.isInteger(line) && line > 0 ? line : null;
  let args = [target];
  if (position && ["code", "cursor", "windsurf"].includes(editor.id)) args = ["--goto", target + ":" + position];
  else if (position && ["zed", "subl"].includes(editor.id)) args = [target + ":" + position];
  if (platform === "darwin") return { command: "/usr/bin/open", args: ["-a", editor.application, ...(position && editor.id !== "custom" ? ["--args", ...args] : [target])] };
  return { command: editor.application, args };
}
export function editorService(settingsFile) {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(settingsFile, "utf8")); } catch {}
  const available = () => {
    const rows = detectEditors();
    if (saved?.id === "custom" && path.isAbsolute(saved.application || "") && fs.existsSync(saved.application)) rows.push(saved);
    return rows;
  };
  return {
    list() { const editors = available(); return { editors, preferred: editors.some(e => e.id === saved?.id) ? saved.id : "" }; },
    save(editor) { saved = editor; fs.mkdirSync(path.dirname(settingsFile), { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify(editor)); },
    async open(id, target, line) {
      const editor = available().find(e => e.id === id);
      if (!editor) throw Error("That editor is no longer installed. Choose another editor.");
      if (typeof target !== "string" || !path.isAbsolute(target) || !fs.existsSync(target)) throw Error("This file or folder is not available locally.");
      const { command, args } = editorCommand(editor, target, line);
      const cli = process.platform === "darwin" && ["code", "cursor", "windsurf"].includes(editor.id)
        ? path.join(editor.application, "Contents", "Resources", "app", "bin", editor.id) : "";
      if (cli && fs.existsSync(cli)) {
        await exec(cli, line ? ["--goto", target + ":" + line] : [target], { timeout: 15000 });
      } else if (process.platform === "darwin") await exec(command, args, { timeout: 15000 });
      else await new Promise((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore", shell: false });
        child.once("error", reject);
        child.once("spawn", () => { child.unref(); resolve(); });
      });
      this.save(editor);
    },
  };
}
