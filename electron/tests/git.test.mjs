import test from "node:test";
import { removeFixture } from "./fixture-cleanup.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gitChanges, gitDiff } from "../main/git.mjs";
test("Git review handles staged/unstaged, renames, deletion, binary, and literal filenames without mutation", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-git-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir });
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    fs.writeFileSync(path.join(dir, "tracked.txt"), "original\n");
    fs.writeFileSync(path.join(dir, "delete.txt"), "remove me\n");
    fs.writeFileSync(path.join(dir, "rename.txt"), "rename me\n");
    git("add", ".");
    git("commit", "-qm", "fixture");
    fs.writeFileSync(path.join(dir, "tracked.txt"), "staged\n");
    git("add", "tracked.txt");
    fs.writeFileSync(path.join(dir, "tracked.txt"), "unstaged\n");
    fs.unlinkSync(path.join(dir, "delete.txt"));
    git("mv", "rename.txt", "renamed name.txt");
    fs.writeFileSync(path.join(dir, "literal[1].txt"), "new content\n");
    fs.writeFileSync(path.join(dir, "binary.dat"), Buffer.from([0, 1, 2]));
    const before = git("diff", "--cached");
    const data = await gitChanges(dir);
    assert.equal(data.files.filter((f) => f.path === "tracked.txt").length, 2);
    assert.match(await gitDiff(dir, "tracked.txt", "staged"), /\+staged/);
    assert.match(await gitDiff(dir, "tracked.txt", "unstaged"), /\+unstaged/);
    assert.match(
      await gitDiff(dir, "renamed name.txt", "staged"),
      /rename from rename.txt/,
    );
    assert.match(await gitDiff(dir, "delete.txt", "unstaged"), /-remove me/);
    assert.match(
      await gitDiff(dir, "literal[1].txt", "untracked"),
      /\+new content/,
    );
    assert.match(await gitDiff(dir, "binary.dat", "untracked"), /Binary file/);
    await assert.rejects(
      gitDiff(dir, "../secret", "untracked"),
      /no longer available/,
    );
    assert.deepEqual(git("diff", "--cached"), before);
    git("reset", "--hard", "-q");
    git("clean", "-fdq");
    assert.equal((await gitChanges(dir)).files.length, 0);
  } finally {
    removeFixture(dir);
  }
});
test("new repositories and folders without Git have clear review states", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-new-git-"));
  try {
    await assert.rejects(gitChanges(dir), /not a Git repository/);
    execFileSync("git", ["init", "-q"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "first.txt"), "first\n");
    execFileSync("git", ["add", "first.txt"], { cwd: dir });
    assert.equal((await gitChanges(dir)).branch, "New repository");
    assert.match(await gitDiff(dir, "first.txt", "staged"), /\+first/);
  } finally {
    removeFixture(dir);
  }
});

test("clean repositories expose recent commits and committed branch changes separately", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-review-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    fs.writeFileSync(path.join(dir, "file.txt"), "initial\n");
    git("add", ".");
    git("commit", "-qm", "Initial fixture");
    const initial = git("rev-parse", "HEAD");
    git("checkout", "-qb", "feature");
    fs.writeFileSync(path.join(dir, "file.txt"), "completed work\n");
    git("add", ".");
    git("commit", "-qm", "Complete feature");
    assert.equal((await gitChanges(dir)).files.length, 0);
    const recent = await gitChanges(dir, "recent");
    assert.equal(recent.commits[0].title, "Complete feature");
    assert.equal(recent.files[0].path, "file.txt");
    assert.match(
      await gitDiff(dir, "file.txt", "committed", "recent", recent.revision),
      /\+completed work/,
    );
    assert.match(
      await gitDiff(dir, "file.txt", "committed", "recent", initial),
      /\+initial/,
    );
    const compare = await gitChanges(dir, "compare");
    assert.equal(compare.base, initial);
    assert.match(
      await gitDiff(dir, "file.txt", "committed", "compare", compare.revision),
      /\+completed work/,
    );
    fs.writeFileSync(path.join(dir, "file.txt"), "not committed\n");
    assert.doesNotMatch(
      await gitDiff(dir, "file.txt", "committed", "compare", compare.revision),
      /not committed/,
    );
    await assert.rejects(gitChanges(dir, "recent", "--all"), /Invalid commit/);
    git("branch", "-D", "main");
    await assert.rejects(gitChanges(dir, "compare"), /No main branch/);
  } finally {
    removeFixture(dir);
  }
});
