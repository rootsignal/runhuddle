import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
const exec = promisify(execFile);
async function git(cwd, args) {
  const { stdout } = await exec(
    "git",
    ["--no-optional-locks", "--literal-pathspecs", ...args],
    {
      cwd,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
    },
  );
  return stdout;
}
export async function gitChanges(cwd) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd))
    throw Error("Choose a workspace folder first.");
  let root;
  try {
    root = (await git(cwd, ["rev-parse", "--show-toplevel"])).replace(
      /\r?\n$/,
      "",
    );
  } catch (e) {
    if (e.code === "ENOENT")
      throw Error("Git is not installed or this folder is unavailable.");
    throw Error("This folder is not a Git repository.");
  }
  const [status, branch] = await Promise.all([
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(
      () => "New repository",
    ),
  ]);
  const tokens = status.split("\0"),
    files = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (!entry) continue;
    const code = entry.slice(0, 2),
      file = entry.slice(3);
    const previous = /[RC]/.test(code) ? tokens[++i] : undefined;
    if (code === "??")
      files.push({ path: file, status: "?", area: "untracked" });
    else {
      if (code[0] !== " ")
        files.push({ path: file, previous, status: code[0], area: "staged" });
      if (code[1] !== " ")
        files.push({ path: file, previous, status: code[1], area: "unstaged" });
    }
  }
  return { root, branch: branch.trim(), files };
}
export async function gitDiff(cwd, file, area) {
  const snapshot = await gitChanges(cwd);
  const entry = snapshot.files.find((f) => f.path === file && f.area === area);
  if (!entry)
    throw Error("This change is no longer available. Refresh the file list.");
  if (area === "untracked") {
    const target = path.resolve(snapshot.root, file);
    if (!target.startsWith(snapshot.root + path.sep))
      throw Error("Invalid repository path");
    // Do not follow symlinks out of the repository.
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink())
      return "Symbolic link → " + (await fs.readlink(target));
    if (!stat.isFile()) return "Preview unavailable for this file type.";
    if (stat.size > 512 * 1024)
      return "File is too large to preview (limit: 512 KB).";
    const bytes = await fs.readFile(target);
    if (bytes.includes(0)) return "Binary file — preview unavailable.";
    return bytes
      .toString("utf8")
      .split("\n")
      .map((line) => "+" + line)
      .join("\n");
  }
  try {
    return (
      (await git(snapshot.root, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        ...(area === "staged" ? ["--cached"] : []),
        "--",
        file,
        ...(entry.previous ? [entry.previous] : []),
      ])) ||
      "No textual diff available (the file may have changed since refresh)."
    );
  } catch (e) {
    if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      return "Diff is too large to preview (limit: 2 MB).";
    throw e;
  }
}
