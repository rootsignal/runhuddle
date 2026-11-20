import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { Service } from "../main/service.mjs";
import { address, dimensions, frames, send } from "../main/protocol.mjs";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  throw Error("Timed out waiting for terminal output");
}
test("validates terminal dimensions", () => {
  for (const invalid of [-1, Infinity, 80.5]) assert.throws(() => dimensions(invalid, 24));
  dimensions(80, 24);
});
test(
  "bundled service owns PTYs across client restart; input, Unicode, resize, replay, exit, auth and shutdown",
  { timeout: 30000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-service-"));
    let client = new Service(dir);
    try {
      await client.connect();
      if (client.hello.compactShell) {
        const compact = await client.call("create", { cwd: dir, agent: "shell", compactShell: true });
        const prompt = "\x1b[36m" + path.basename(dir) + "\x1b[0m \x1b[32m❯\x1b[0m ";
        await until(async () => (await client.call("replay", { id: compact.id })).data.includes(prompt));
        assert.doesNotMatch((await client.call("replay", { id: compact.id })).data, /default interactive shell is now zsh/);
        await client.call("write", { id: compact.id, data: "cd /\r" });
        await until(async () => (await client.call("replay", { id: compact.id })).data.includes("\x1b]7;file://localhost/\x07"));
        await client.call("close", { id: compact.id });
      }
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
      const sizesSeen = [];
      client.on("event", (event) => {
        if (event.id === terminal.id) sizesSeen.push(event);
      });
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
      assert.equal(first.sizes.length, 2);
      assert.deepEqual(first.sizes[0], { offset: 0, cols: 90, rows: 28 });
      const newSize = first.sizes[1];
      assert.deepEqual({ cols: newSize.cols, rows: newSize.rows }, { cols: 110, rows: 35 });
      assert.ok(first.data.slice(0, newSize.offset).includes("RH_START"));
      if (!windows) assert.ok(first.data.slice(newSize.offset).includes("35 110"));
      const resizeEvent = sizesSeen.findIndex((event) => event.event === "terminal-size");
      assert.ok(resizeEvent >= 0);
      assert.ok(sizesSeen.slice(0, resizeEvent).every((event) => event.sequence < sizesSeen[resizeEvent].sequence));
      assert.ok(sizesSeen.slice(resizeEvent + 1).every((event) => event.sequence > sizesSeen[resizeEvent].sequence));
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
