import test from "node:test";
import { removeFixture } from "./fixture-cleanup.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gitChanges, gitDiff, gitTurnCommittedDiffs, gitTurnSnapshot } from "../main/git.mjs";
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
    for (const area of ["staged", "unstaged"]) {
      const file = data.files.find((file) => file.path === "tracked.txt" && file.area === area);
      assert.deepEqual([file.additions, file.deletions], [1, 1]);
    }
    const renamed = data.files.find((file) => file.path === "renamed name.txt");
    assert.deepEqual([renamed.additions, renamed.deletions], [0, 0]);
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
    const turnStart = await gitTurnSnapshot(dir);
    fs.writeFileSync(path.join(dir, "tracked.txt"), "changed during turn\n");
    const turnEnd = await gitTurnSnapshot(dir);
    const entry = (snapshot, file, area) => snapshot.entries.find((item) => item.file.path === file && item.file.area === area);
    assert.equal(turnStart.head, turnEnd.head);
    assert.equal(entry(turnStart, "tracked.txt", "staged").fingerprint, entry(turnEnd, "tracked.txt", "staged").fingerprint);
    assert.notEqual(entry(turnStart, "tracked.txt", "unstaged").fingerprint, entry(turnEnd, "tracked.txt", "unstaged").fingerprint);
    assert.match(entry(turnEnd, "tracked.txt", "unstaged").diff, /\+changed during turn/);
    assert.equal(turnEnd.entries.some((item) => item.file.path === "binary.dat"), false);
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
    assert.deepEqual([recent.files[0].additions, recent.files[0].deletions], [1, 1]);
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
    git("branch", "develop");
    const develop = await gitChanges(dir, "compare", "", "refs/heads/develop");
    assert.equal(develop.comparison.targetRef, "refs/heads/develop");
    assert.equal(develop.base, develop.revision);
    assert.deepEqual(develop.files, []);
    assert.equal(develop.uncommittedFiles, 1);
    git("branch", "-D", "main");
    const deleted = await gitChanges(dir, "compare", "", "refs/heads/main");
    assert.equal(deleted.comparison.targetRef, "");
    assert.match(deleted.comparison.problem, /no longer available/);
    assert.deepEqual(deleted.comparison.refs, ["refs/heads/develop", "refs/heads/feature"]);
  } finally {
    removeFixture(dir);
  }
});

test("turn commit capture spans multiple commits and works with a clean checkout", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-git-turn-commits-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir });
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    const file = path.join(dir, "review.txt");
    fs.writeFileSync(file, "baseline\n");
    git("add", "review.txt");
    git("commit", "-qm", "baseline");
    const start = await gitTurnSnapshot(dir);
    for (const [text, subject] of [["intermediate", "first edit"], ["final review", "second edit"]]) {
      fs.writeFileSync(file, text + "\n");
      git("commit", "-qam", subject);
    }
    const end = await gitTurnSnapshot(dir);
    assert.deepEqual(end.entries, []);
    const result = await gitTurnCommittedDiffs(dir, start.head, end.head);
    assert.equal(result.omitted, 0);
    assert.deepEqual(result.entries.map(({ file }) => file), [{ path: "review.txt", status: "M", area: "committed" }]);
    assert.match(result.entries[0].diff, /-baseline\n\+final review/);
    assert.doesNotMatch(result.entries[0].diff, /intermediate/);
    assert.equal(await gitTurnCommittedDiffs(dir, end.head, start.head), undefined);
  } finally {
    removeFixture(dir);
  }
});
