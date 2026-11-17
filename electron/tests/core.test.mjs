import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { DatabaseSync } from "node:sqlite";
import { Service } from "../main/service.mjs";
import { readStore } from "../main/store.mjs";
import { address, dimensions, frames, send } from "../main/protocol.mjs";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  throw Error("Timed out waiting for terminal output");
}
test("native snapshot reads SQLite WAL, preserves notes and never changes records", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-store-"));
  const file = path.join(dir, "sessions.sqlite");
  const db = new DatabaseSync(file);
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE records(key TEXT PRIMARY KEY,value BLOB)",
    );
    const sessions = [
      { provider: "Claude", sessionID: "one", title: "Test", state: "idle" },
    ];
    const insert = db.prepare("INSERT INTO records VALUES (?,?)");
    insert.run("sessions", Buffer.from(JSON.stringify(sessions)));
    insert.run(
      "savedWorkLibrary",
      Buffer.from('[{"id":"note","text":"keep me"}]'),
    );
    const before = db
      .prepare("SELECT key,hex(value) AS value FROM records ORDER BY key")
      .all();
    const snapshot = readStore(file);
    assert.deepEqual(snapshot.sessions, sessions);
    assert.equal(snapshot.notes[0].text, "keep me");
    assert.deepEqual(
      db
        .prepare("SELECT key,hex(value) AS value FROM records ORDER BY key")
        .all(),
      before,
    );
    assert.deepEqual(readStore(path.join(dir, "absent")).sessions, []);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("rejects invalid resize and malformed store records", () => {
  assert.throws(() => dimensions(-1, 24));
  assert.throws(() => dimensions(80, Infinity));
  assert.throws(() => dimensions(80.5, 24));
  dimensions(80, 24);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-invalid-"));
  const file = path.join(dir, "db");
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE records(key TEXT,value BLOB);INSERT INTO records VALUES ('sessions','{}')",
  );
  db.close();
  assert.throws(() => readStore(file), /Unexpected/);
  fs.rmSync(dir, { recursive: true, force: true });
});
test(
  "bundled service owns PTYs across client restart; input, Unicode, resize, replay, exit, auth and shutdown",
  { timeout: 30000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-service-"));
    let client = new Service(dir);
    try {
      await client.connect();
      const terminal = await client.call("create", {
        cwd: dir,
        agent: "shell",
        cols: 90,
        rows: 28,
      });
      await assert.rejects(
        client.call("create", { cwd: dir, agent: "not-an-agent" }),
      );
      await assert.rejects(
        client.call("create", { cwd: path.join(dir, "missing") }),
      );
      const windows = process.platform === "win32";
      const command = windows ? "echo RH_START\r" : "printf 'RH_%s\\n' START\r";
      await client.call("write", { id: terminal.id, data: command });
      await until(async () =>
        (await client.call("replay", { id: terminal.id })).data.includes(
          "RH_START",
        ),
      );
      await client.call("resize", { id: terminal.id, cols: 110, rows: 35 });
      if (!windows) {
        await client.call("write", {
          id: terminal.id,
          data: "stty size; printf '\\342\\234\\223\\n'\r",
        });
        await until(async () => {
          const r = await client.call("replay", { id: terminal.id });
          return r.data.includes("35 110") && r.data.includes("✓");
        });
      }
      const first = await client.call("replay", { id: terminal.id });
      client.disconnect();
      await sleep(100);
      client = new Service(dir);
      await client.connect();
      assert.equal((await client.call("list"))[0].id, terminal.id);
      assert.ok(
        (await client.call("replay", { id: terminal.id })).data.includes(
          "RH_START",
        ),
      );
      await client.call("write", {
        id: terminal.id,
        data: windows
          ? "echo RH_RECONNECTED\r"
          : "printf 'RH_%s\\n' RECONNECTED\r",
      });
      await until(async () => {
        const r = await client.call("replay", { id: terminal.id });
        return r.sequence > first.sequence && r.data.includes("RH_RECONNECTED");
      });
      const socket = net.createConnection(address(dir));
      await new Promise((resolve) => socket.once("connect", resolve));
      let received = false;
      frames(socket, () => {
        received = true;
      });
      const closed = new Promise((resolve) => socket.once("close", resolve));
      send(socket, { method: "hello", request: 1, token: "wrong" });
      await closed;
      assert.equal(received, false);
      await client.call("write", { id: terminal.id, data: "exit\r" });
      await until(async () => (await client.call("list"))[0].exited);
      assert.equal((await client.call("list"))[0].exitCode, 0);
      await client.call("close", { id: terminal.id });
      assert.deepEqual(await client.call("list"), []);
    } finally {
      await client.call("shutdown").catch(() => {});
      client.disconnect();
      await sleep(150);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
