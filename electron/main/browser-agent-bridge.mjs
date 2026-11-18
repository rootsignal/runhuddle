import net from "node:net";
import fs from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { frames, send } from "./protocol.mjs";
import { browserAgentAddress } from "./browser-agent-config.mjs";

export function browserAgentBridge(directory, currentPreview, canUseTerminal) {
  const endpoint = browserAgentAddress(directory);
  let grant, listener, listening;
  let busy = false, generation = 0;
  const peers = new Set();

  function revoke() {
    generation++;
    if (!grant) return;
    grant = undefined;
    currentPreview()?.setAgentSession(null);
  }

  async function listen() {
    if (listening) return listening;
    const server = net.createServer((socket) => {
      if (peers.size >= 8) return socket.destroy();
      peers.add(socket);
      socket.setTimeout(10000, () => socket.destroy());
      socket.on("close", () => peers.delete(socket));
      socket.on("error", () => {});
      let used = false;
      frames(socket, async (request) => {
        if (used) return socket.destroy();
        used = true;
        const active = grant;
        const authorized = () => !!active && active === grant && canUseTerminal(active.id);
        try {
          const key = typeof request?.key === "string" ? request.key : "";
          if (!authorized() || key.length !== 64 || !/^[0-9a-f]+$/.test(key) ||
              !timingSafeEqual(Buffer.from(key), Buffer.from(active.key)))
            throw Error("Allow agent control for this session in RunHuddle’s Browser pane first.");
          if (busy) throw Error("Another browser action is in progress. Try again shortly.");
          busy = true;
          try {
            const content = await currentPreview().agentAction(request.name, request.args, active.origin,
              () => authorized() && !socket.destroyed);
            send(socket, { content });
          } finally {
            busy = false;
          }
        } catch (error) {
          send(socket, { error: error.message });
        } finally {
          socket.end();
        }
      });
    });
    listening = new Promise((resolve, reject) => {
      const failure = (error) => {
        listening = undefined;
        reject(error);
      };
      server.once("error", failure);
      try {
        if (process.platform !== "win32") {
          const existing = fs.lstatSync(endpoint, { throwIfNoEntry: false });
          if (existing?.isSocket() && existing.uid === process.getuid()) fs.unlinkSync(endpoint);
        }
        server.listen(endpoint, () => {
          try {
            if (process.platform !== "win32") fs.chmodSync(endpoint, 0o600);
            server.removeListener("error", failure);
            server.on("error", revoke);
            listener = server;
            resolve();
          } catch (error) {
            server.close();
            failure(error);
          }
        });
      } catch (error) {
        failure(error);
      }
    });
    return listening;
  }

  async function allow(id, readKey) {
    const request = ++generation;
    const preview = currentPreview();
    const origin = preview?.agentOrigin();
    if (!origin) throw Error("Open a local app in Browser first.");
    const key = await readKey();
    if (!/^[0-9a-f]{64}$/.test(key)) throw Error("This terminal needs to be reopened for browser tools.");
    await listen();
    if (request !== generation || !canUseTerminal(id) || currentPreview() !== preview || preview.agentOrigin() !== origin)
      throw Error("The selected session or page changed. Try again.");
    grant = { id, key, origin };
    preview.setAgentSession(id, origin);
  }

  return {
    allow, revoke,
    close() {
      revoke();
      for (const socket of peers) socket.destroy();
      listener?.close();
    },
  };
}
