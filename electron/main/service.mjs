import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { address, frames, send, PROTOCOL } from "./protocol.mjs";
export class Service extends EventEmitter {
  constructor(directory) {
    super();
    this.directory = directory;
    this.pending = new Map();
    this.sequence = 0;
  }
  async connect() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const tokenFile = path.join(this.directory, "service.token");
    try {
      fs.writeFileSync(tokenFile, randomBytes(32).toString("hex"), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    this.token = fs.readFileSync(tokenFile, "utf8");
    try {
      await this.open();
    } catch (error) {
      if (!["ENOENT", "ECONNREFUSED"].includes(error.code)) throw error;
      const endpoint = address(this.directory);
      if (process.platform !== "win32") {
        try {
          fs.unlinkSync(endpoint);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      const log = fs.openSync(
        path.join(this.directory, "service.log"),
        "a",
        0o600,
      );
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./daemon.mjs", import.meta.url)),
          this.directory,
        ],
        {
          detached: true,
          stdio: ["ignore", log, log],
          windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        },
      );
      fs.closeSync(log);
      child.unref();
      let spawnError;
      child.on("error", (e) => {
        spawnError = e;
      });
      let connected = false;
      for (let i = 0; i < 50; i++) {
        if (spawnError) throw spawnError;
        await new Promise((resolve) => setTimeout(resolve, 100));
        try {
          await this.open();
          connected = true;
          break;
        } catch (e) {
          if (!["ENOENT", "ECONNREFUSED"].includes(e.code)) throw e;
        }
      }
      if (!connected)
        throw new Error(
          "Terminal service did not start. See service.log in preview settings.",
        );
    }
    const hello = await this.call("hello", { token: this.token });
    if (hello.protocol !== PROTOCOL) {
      this.disconnect();
      throw new Error("Terminal service needs a compatible app version");
    }
  }
  open() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(address(this.directory));
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.removeListener("error", reject);
        this.socket = socket;
        socket.on("error", () => {});
        socket.on("close", () => {
          for (const { reject, timer } of this.pending.values()) {
            clearTimeout(timer);
            reject(new Error("Terminal service disconnected"));
          }
          this.pending.clear();
          this.emit("disconnected");
        });
        frames(socket, (value) => {
          if (value.event) {
            this.emit("event", value);
            return;
          }
          const pending = this.pending.get(value.request);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(value.request);
            value.error
              ? pending.reject(new Error(value.error))
              : pending.resolve(value.result);
          }
        });
        resolve();
      });
    });
  }
  call(method, args = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed)
        return reject(new Error("Terminal service is not connected"));
      const request = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(request);
        reject(new Error("Terminal service timed out"));
      }, 8000);
      this.pending.set(request, { resolve, reject, timer });
      send(this.socket, { ...args, method, request });
    });
  }
  disconnect() {
    this.socket?.destroy();
  }
}
