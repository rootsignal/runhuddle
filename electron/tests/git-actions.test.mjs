import test from "node:test";
import { removeFixture } from "./fixture-cleanup.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gitAction, gitChanges, watchRepository } from "../main/git.mjs";
test("explicit staging, initial unstage, index-only commits and upstream push", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-actions-"));
  const work = path.join(dir, "work"), remote = path.join(dir, "remote");
  fs.mkdirSync(work);
  const git = (...args) => execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
    fs.writeFileSync(path.join(work, "a[1].txt"), "first");
    fs.writeFileSync(path.join(work, "other.txt"), "excluded");
    await gitAction(work, "stage", "a[1].txt");
    await gitAction(work, "unstage", "a[1].txt");
    assert.equal(git("diff", "--cached", "--name-only"), "");
    await gitAction(work, "stage", "a[1].txt");
    await gitAction(work, "commit", "Initial selected file");
    assert.equal(git("ls-tree", "--name-only", "HEAD"), "a[1].txt");
    fs.writeFileSync(path.join(work, "a[1].txt"), "staged");
    await gitAction(work, "stage", "a[1].txt");
    fs.writeFileSync(path.join(work, "a[1].txt"), "not staged");
    await gitAction(work, "commit", "Only the index");
    assert.equal(git("show", "HEAD:a[1].txt"), "staged");
    assert.equal(fs.readFileSync(path.join(work, "a[1].txt"), "utf8"), "not staged");
    await assert.rejects(gitAction(work, "stage", "../outside"), /changed/);
    await assert.rejects(gitAction(work, "push"), /No upstream/);
    execFileSync("git", ["init", "--bare", "-q", remote]);
    git("remote", "add", "origin", remote); git("push", "-qu", "origin", "main");
    await gitAction(work, "stage", "a[1].txt"); await gitAction(work, "commit", "Ready to push");
    assert.equal((await gitChanges(work)).ahead, 1);
    await gitAction(work, "push");
    assert.equal((await gitChanges(work)).ahead, 0);
    await gitAction(work, "stage", "other.txt"); await gitAction(work, "unstage", "other.txt");
    assert.equal(fs.readFileSync(path.join(work, "other.txt"), "utf8"), "excluded");
  } finally { removeFixture(dir); }
});
test("repository watcher emits for edits and stops cleanly", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-watch-"));
  let stop = () => {};
  try {
    execFileSync("git", ["init", "-q", dir]);
    let calls = 0;
    stop = await watchRepository(dir, () => calls++);
    fs.writeFileSync(path.join(dir, "change.txt"), "one");
    await new Promise(r => setTimeout(r, 1100));
    assert.ok(calls > 0);
    stop(); const before = calls;
    fs.writeFileSync(path.join(dir, "change.txt"), "two");
    await new Promise(r => setTimeout(r, 850));
    assert.equal(calls, before);
  } finally { stop(); removeFixture(dir); }
});
test("bulk staging respects ignores and bulk unstaging preserves edits, deletions and new files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-bulk-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
    fs.writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\n");
    fs.writeFileSync(path.join(dir, "kept.txt"), "original");
    fs.writeFileSync(path.join(dir, "deleted.txt"), "original");
    fs.writeFileSync(path.join(dir, "ignored.txt"), "ignored");
    await gitAction(dir, "stage-all");
    assert.ok(!(await gitChanges(dir)).files.some(f => f.path === "ignored.txt"));
    await gitAction(dir, "unstage-all");
    assert.ok((await gitChanges(dir)).files.every(f => f.area === "untracked"));
    await gitAction(dir, "stage-all"); await gitAction(dir, "commit", "baseline");
    fs.writeFileSync(path.join(dir, "kept.txt"), "edited");
    fs.unlinkSync(path.join(dir, "deleted.txt"));
    fs.writeFileSync(path.join(dir, "new[1].txt"), "new");
    await gitAction(dir, "stage-all");
    assert.equal((await gitChanges(dir)).files.filter(f => f.area === "staged").length, 3);
    fs.writeFileSync(path.join(dir, "kept.txt"), "later edit");
    await gitAction(dir, "unstage-all");
    assert.equal(git("diff", "--cached", "--name-only"), "");
    assert.equal(fs.readFileSync(path.join(dir, "kept.txt"), "utf8"), "later edit");
    assert.equal(fs.readFileSync(path.join(dir, "new[1].txt"), "utf8"), "new");
    assert.equal(fs.existsSync(path.join(dir, "deleted.txt")), false);
  } finally { removeFixture(dir); }
});
