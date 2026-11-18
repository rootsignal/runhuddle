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
      timeout: args[0] === "push" ? 120000 : 30000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
    },
  );
  return stdout;
}
export async function gitChanges(cwd, mode = "working", revision = "") {
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
  const upstream = await git(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]).then(v => v.trim(), () => "");
  const counts = upstream ? await git(root, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).catch(() => "0 0") : "0 0";
  const [ahead, behind] = counts.trim().split(/\s+/).map(Number);
  const result = mode !== "working" ? await review(root, branch.trim(), mode, revision) : { root, branch: branch.trim(), files };
  return { ...result, upstream, ahead, behind };
}
export async function gitDiff(
  cwd,
  file,
  area,
  mode = "working",
  revision = "",
) {
  const snapshot = await gitChanges(cwd, mode, revision);
  const entry = snapshot.files.find((f) => f.path === file && f.area === area);
  if (!entry)
    throw Error("This change is no longer available. Refresh the file list.");
  if (mode !== "working") {
    return git(
      snapshot.root,
      snapshot.base
        ? [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            snapshot.base,
            snapshot.revision,
            "--",
            file,
          ]
        : [
            "show",
            "--format=",
            "--first-parent",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            snapshot.revision,
            "--",
            file,
          ],
    );
  }
  if (area === "untracked") {
    const target = path.resolve(snapshot.root, file);
    const relative = path.relative(snapshot.root, target);
    if (!relative || path.isAbsolute(relative) || relative.split(path.sep)[0] === "..")
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

async function review(root, branch, mode, revision) {
  if (!["recent", "compare"].includes(mode)) throw Error("Unknown review mode");
  const log = await git(root, ["log", "-30", "--format=%H%x00%s"]).catch(
    () => "",
  );
  const commits = log
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, title] = line.split("\0");
      return { id, title };
    });
  if (!commits.length) return { root, branch, files: [], commits };
  if (revision && !/^[a-f0-9]{40,64}$/.test(revision))
    throw Error("Invalid commit ID");
  const target = revision || commits[0].id;
  let base;
  if (mode === "compare") {
    for (const ref of ["refs/heads/main", "refs/remotes/origin/main"]) {
      try {
        base = (await git(root, ["merge-base", ref, target])).trim();
        break;
      } catch {}
    }
    if (!base)
      throw Error(
        "No main branch with shared history was found locally. Fetch or create main to compare.",
      );
  }
  const list = await git(
    root,
    base
      ? ["diff", "--no-renames", "--name-status", "-z", base, target]
      : [
          "show",
          "--format=",
          "--first-parent",
          "--no-renames",
          "--name-status",
          "-z",
          target,
        ],
  );
  const tokens = list.split("\0"),
    files = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    if (tokens[i] && tokens[i + 1])
      files.push({
        path: tokens[i + 1],
        status: tokens[i].trim(),
        area: "committed",
      });
  }
  return { root, branch, files, commits, revision: target, base };
}

// Writes are explicit user actions; resetting the index never changes working files.
const writes = new Set();
export async function gitAction(cwd, action, input = "") {
  const snapshot = await gitChanges(cwd);
  const root = snapshot.root;
  if (writes.has(root)) throw Error("Another Git action is still running.");
  writes.add(root);
  try {
    if (action === "stage-all") {
      await git(root, ["add", "--all", "--", "."]);
    } else if (action === "unstage-all") {
      const hasHead = await git(root, ["rev-parse", "--verify", "HEAD"]).then(() => true, () => false);
      await git(root, hasHead ? ["reset", "--mixed", "HEAD"] : ["read-tree", "--empty"]);
    } else if (action === "stage" || action === "unstage") {
      const file = snapshot.files.find(f => f.path === input &&
        (action === "unstage" ? f.area === "staged" : f.area !== "staged"));
      if (!file) throw Error("The file changed. Refresh and try again.");
      const paths = [file.path, ...(file.previous ? [file.previous] : [])];
      if (action === "stage") await git(root, ["add", "--", ...paths]);
      else {
        const hasHead = await git(root, ["rev-parse", "--verify", "HEAD"]).then(() => true, () => false);
        await git(root, hasHead ? ["reset", "HEAD", "--", ...paths] : ["rm", "--cached", "--", ...paths]);
      }
    } else if (action === "commit") {
      if (typeof input !== "string" || !input.trim() || input.length > 20000) throw Error("Enter a commit message.");
      if (!snapshot.files.some(f => f.area === "staged")) throw Error("Stage files before committing.");
      const conflicts = await git(root, ["diff", "--name-only", "--diff-filter=U"]);
      if (conflicts.trim()) throw Error("Resolve merge conflicts before committing.");
      await git(root, ["commit", "-m", input.trim()]);
    } else if (action === "push") {
      if (!snapshot.upstream) throw Error("No upstream configured. Publish this branch from your terminal first.");
      if (snapshot.behind > 0) throw Error("The branch is behind its upstream. Pull or rebase in your terminal before pushing.");
      // Use this branch's explicit upstream, regardless of push.default settings.
      const branch = (await git(root, ["symbolic-ref", "--short", "HEAD"])).trim();
      const remote = (await git(root, ["config", "--get", "branch." + branch + ".remote"])).trim();
      const ref = (await git(root, ["config", "--get", "branch." + branch + ".merge"])).trim();
      if (!remote || remote.startsWith("-") || !ref.startsWith("refs/heads/")) throw Error("Invalid upstream configuration.");
      await git(root, ["push", "--", remote, "HEAD:" + ref]);
    } else throw Error("Unsupported Git action.");
    return gitChanges(root);
  } finally { writes.delete(root); }
}

export async function watchRepository(cwd, notify) {
  if (!cwd) return () => {};
  let root, gitDir, commonDir;
  try {
    root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    gitDir = (await git(cwd, ["rev-parse", "--absolute-git-dir"])).trim();
    commonDir = path.resolve(cwd, (await git(cwd, ["rev-parse", "--git-common-dir"])).trim());
  } catch { return () => {}; }
  const watchers = [];
  let timer, stopped = false;
  const changed = (_event, file) => {
    const parts = String(file || "").split(/[\\/]/);
    if (parts.some(p => ["node_modules", ".git", "dist", ".next", "build", "objects"].includes(p)) ||
      parts.at(-1)?.endsWith(".lock")) return;
    if (!timer) timer = setTimeout(() => { timer = null; if (!stopped) notify(); }, 750);
  };
  const { watch } = await import("node:fs");
  for (const folder of new Set([root, gitDir, commonDir])) {
    try {
      const watcher = watch(folder, { recursive: true }, changed);
      watcher.on("error", () => watcher.close());
      watchers.push(watcher);
    } catch {}
  }
  return () => { stopped = true; clearTimeout(timer); watchers.forEach(w => w.close()); };
}
