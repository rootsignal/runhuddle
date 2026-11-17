import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mergeSessions } from "./lifecycle.mjs";
import { TerminalInventory } from "./terminal-inventory.mjs";
import { Service } from "./service.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
app.setName("RunHuddle Preview");
app.setPath(
  "userData",
  process.env.RUNHUDDLE_PREVIEW_DATA ||
    path.join(app.getPath("appData"), "RunHuddle Preview"),
);
const nativeStore =
  process.env.RUNHUDDLE_NATIVE_STORE ||
  path.join(app.getPath("appData"), "RunHuddle", "sessions.sqlite");
const service = new Service(path.join(app.getPath("userData"), "service-v2"));
const legacy = new Service(path.join(app.getPath("userData"), "service"));
const inventory = new TerminalInventory(
  path.join(app.getPath("userData"), "terminal-inventory.json"),
);
let connection = "connected",
  quitting = false,
  recovering;
let legacyConnected = false;
let managed = [];
const linksFile = path.join(app.getPath("userData"), "legacy-links.json");
let links = [];
try {
  links = JSON.parse(fs.readFileSync(linksFile, "utf8"));
  if (!Array.isArray(links)) links = [];
} catch {}
let legacySessions = [];
const merged = () =>
  mergeSessions(mergeSessions(cached.sessions, managed), legacySessions);

let ownedIds = new Set();
const allTerminals = async () => {
  const rows = await service.call("list");
  ownedIds = new Set(rows.map((t) => t.id));
  const old = legacyConnected ? await legacy.call("list") : [];
  legacySessions = links.flatMap((link) => {
    const t = old.find((t) => t.id === link.terminalId && !t.exited);
    const row = mergeSessions(cached.sessions, managed).find(
      (s) => s.provider === link.provider && s.sessionID === link.sessionID,
    );
    return t && row
      ? [{ ...row, terminalId: t.id, state: "disconnected" }]
      : [];
  });
  return inventory.reconcile([
    ...rows,
    ...old.map((t) => ({
      ...t,
      sessionID: links.find((l) => l.terminalId === t.id)?.sessionID,
      legacy: true,
    })),
  ]);
};
const owner = async (id) =>
  ownedIds.has(id) || !legacyConnected ? service : legacy;
const publishStore = () =>
  publish({
    event: "store",
    ...cached,
    sessions: merged(),
    storeError,
  });
async function serviceEvent(event) {
  if (event.event === "terminals") {
    publish({ ...event, terminals: await allTerminals() });
    publishStore();
  } else if (event.event === "history") {
    managed = event.sessions;
    publishStore();
  } else publish(event);
}

const documentURL = pathToFileURL(path.join(root, "../dist/index.html")).href;
let window,
  watcher,
  refreshTimer,
  refreshing = false,
  refreshAgain = false;
let cached = { sessions: [], notes: [], pinned: [], readAt: null };
let storeError = null;
const publish = (event) => {
  if (window && !window.isDestroyed()) window.webContents.send("event", event);
};
async function refresh() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    cached = await new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./store-worker.mjs", import.meta.url),
        { workerData: nativeStore },
      );
      worker.once("message", (message) =>
        message.error
          ? reject(new Error(message.error))
          : resolve(message.result),
      );
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code) reject(new Error("Session reader stopped"));
      });
    });
    storeError = null;
  } catch (error) {
    storeError = error.message;
  } finally {
    refreshing = false;
    publishStore();
    if (refreshAgain) {
      refreshAgain = false;
      scheduleRefresh();
    }
  }
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 500);
}
function handle(name, callback) {
  ipcMain.handle(name, (event, ...args) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== documentURL
    )
      throw new Error("Untrusted app frame");
    return callback(...args);
  });
}
function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 550,
    backgroundColor: "#10151d",
    title: "RunHuddle Preview",
    webPreferences: {
      preload: path.join(root, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  // Only the packaged app frame can enumerate fonts for its appearance picker.
  const canReadFonts = (contents, permission, url) =>
    permission === "local-fonts" &&
    contents === window?.webContents &&
    url === documentURL;
  window.webContents.session.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      canReadFonts(contents, permission, details.requestingUrl),
  );
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(canReadFonts(contents, permission, details.requestingUrl)),
  );

  window.on("closed", () => {
    window = undefined;
  });
  window.loadURL(documentURL);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      window.restore();
      window.focus();
    } else createWindow();
  });
  app
    .whenReady()
    .then(async () => {
      legacyConnected = await legacy.connectExisting();
      await service.connect();
      managed = await service.call("sessions");
      await refresh();
      await allTerminals();
      service.on("event", (event) => serviceEvent(event).catch(() => {}));
      if (legacyConnected)
        legacy.on("event", (event) => serviceEvent(event).catch(() => {}));
      async function recover() {
        if (quitting) return;
        if (recovering) return recovering;
        connection = "reconnecting";
        publish({ event: "connection", state: connection });
        recovering = (async () => {
          for (let attempt = 0; attempt < 3 && !quitting; attempt++) {
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
            try {
              await service.connect();
              if (quitting) {
                service.disconnect();
                return;
              }
              managed = await service.call("sessions");
              const terminals = await allTerminals();
              publishStore();
              publish({ event: "terminals", terminals });
              connection = "connected";
              publish({ event: "connection", state: connection });
              return;
            } catch {}
          }
          if (!quitting) {
            connection = "disconnected";
            publish({ event: "connection", state: connection });
          }
        })().finally(() => {
          recovering = undefined;
        });
        return recovering;
      }
      service.on("disconnected", recover);
      legacy.on("disconnected", () => {
        legacyConnected = false;
        if (!quitting && connection === "connected")
          allTerminals()
            .then((terminals) => {
              publish({ event: "terminals", terminals });
              publishStore();
            })
            .catch(() => {});
      });
      handle("reconnect", recover);
      handle("snapshot", async () => ({
        ...cached,
        storeError,
        sessions: merged(),
        terminals:
          connection === "connected" ? await allTerminals() : inventory.rows,
        connection,
        home: os.homedir(),
      }));
      handle("choose-folder", async () => {
        const result = await dialog.showOpenDialog(window, {
          properties: ["openDirectory"],
          title: "Choose a project folder",
        });
        return result.canceled ? null : result.filePaths[0];
      });
      handle("create", (cwd, agent) => service.call("create", { cwd, agent }));
      handle("resume", async (provider, sessionID) => {
        const row = merged().find(
          (s) => s.provider === provider && s.sessionID === sessionID,
        );
        if (!row || row.simulated) throw Error("Session not available");
        const agent = provider.toLowerCase();
        const existing = (await allTerminals()).find(
          (t) => t.agent === agent && t.sessionID === sessionID && !t.exited,
        );
        if (existing) return existing;
        if (
          ["working", "idle", "needsInput"].includes(
            cached.sessions.find(
              (s) => s.provider === provider && s.sessionID === sessionID,
            )?.state || row.state,
          )
        ) {
          const answer = await dialog.showMessageBox(window, {
            type: "question",
            message: "Resume a session that may still be open elsewhere?",
            detail:
              "The last recorded status says this session was open. Close its other client first to avoid overlapping work.",
            buttons: ["Cancel", "Resume here"],
            defaultId: 0,
            cancelId: 0,
          });
          if (answer.response !== 1) return null;
        }
        return service.call("create", {
          cwd: row.cwd,
          agent,
          resume: sessionID,
        });
      });
      handle("link", async (provider, sessionID, id) => {
        const row = cached.sessions.find(
          (s) =>
            s.provider === provider &&
            s.sessionID === sessionID &&
            !s.simulated,
        );
        const terminal = (await allTerminals()).find(
          (t) => t.id === id && t.legacy && !t.exited,
        );
        if (
          !row ||
          !terminal ||
          terminal.agent !== provider.toLowerCase() ||
          terminal.cwd !== row.cwd
        )
          throw Error("Choose an open terminal for this agent and folder");
        links = links.filter(
          (l) =>
            l.terminalId !== id &&
            !(l.provider === provider && l.sessionID === sessionID),
        );
        links.push({ terminalId: id, provider, sessionID });
        fs.writeFileSync(linksFile, JSON.stringify(links), { mode: 0o600 });
        await service.call("adopt", { session: row });
        publish({ event: "terminals", terminals: await allTerminals() });
        publishStore();
        return terminal;
      });
      handle("title", async (id, title) => {
        if (ownedIds.has(id)) await service.call("title", { id, title });
      });
      handle("archive", async (provider, sessionID, archived) => {
        if (
          (await allTerminals()).some(
            (t) =>
              t.agent === provider.toLowerCase() &&
              t.sessionID === sessionID &&
              !t.exited,
          )
        )
          throw Error("End the session before archiving it");
        if (
          !managed.some(
            (s) => s.provider === provider && s.sessionID === sessionID,
          )
        ) {
          const row = cached.sessions.find(
            (s) => s.provider === provider && s.sessionID === sessionID,
          );
          if (!row || row.simulated) throw Error("Session not available");
          await service.call("adopt", { session: row });
        }
        return service.call("archive", { provider, sessionID, archived });
      });
      handle("replay", async (id) => (await owner(id)).call("replay", { id }));
      handle("write", async (id, data) =>
        (await owner(id)).call("write", { id, data }),
      );
      handle("resize", async (id, cols, rows) =>
        (await owner(id)).call("resize", { id, cols, rows }),
      );
      handle("close", async (id) => {
        const terminal = (await allTerminals()).find((t) => t.id === id);
        const target = await owner(id);
        if (!terminal) return true;
        if (terminal.unavailable) {
          inventory.forget(id);
          publish({ event: "terminals", terminals: inventory.rows });
          return true;
        }
        if (terminal.exited) {
          inventory.forget(id);
          await target.call("close", { id });
          return true;
        }
        const isAgent = terminal.agent !== "shell";
        const result = await dialog.showMessageBox(window, {
          type: "question",
          message: isAgent ? "End this AI session?" : "Close this terminal?",
          detail: isAgent
            ? terminal.legacy && terminal.agent === "codex"
              ? "This closes the older terminal connection. Work may continue in the Codex background server."
              : "This stops the agent process. To keep it running, cancel and close only its tab."
            : "Any process running in this terminal will be stopped.",
          buttons: ["Cancel", isAgent ? "End session" : "Close terminal"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 1) {
          inventory.forget(id);
          await target.call("close", { id });
          return true;
        }
        return false;
      });
      try {
        watcher = fs.watch(path.dirname(nativeStore), (_event, name) => {
          if (!name || String(name).startsWith(path.basename(nativeStore)))
            scheduleRefresh();
        });
      } catch {
        /* No native app data yet. Manual refresh remains available. */
      }
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "RunHuddle Preview",
            submenu: [
              { label: "About RunHuddle Preview", role: "about" },
              { type: "separator" },
              {
                label: "Quit preview (keep terminals running)",
                accelerator: "CmdOrCtrl+Q",
                click: () => app.quit(),
              },
              {
                label: "Quit and stop all preview terminals…",
                click: async () => {
                  const result = await dialog.showMessageBox(window, {
                    type: "question",
                    message: "Stop all preview terminals and quit?",
                    buttons: ["Cancel", "Stop and quit"],
                    defaultId: 0,
                    cancelId: 0,
                  });
                  if (result.response === 1) {
                    quitting = true;
                    await service.call("shutdown");
                    if (legacyConnected) await legacy.call("shutdown");
                    app.quit();
                  }
                },
              },
            ],
          },
          { role: "editMenu" },
          {
            label: "View",
            submenu: [
              { role: "reload" },
              { role: "toggleDevTools" },
              { label: "Refresh native session snapshot", click: refresh },
              { role: "togglefullscreen" },
            ],
          },
        ]),
      );
      createWindow();
      app.on("activate", () => {
        if (!window) createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox("RunHuddle Preview could not start", error.message);
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    watcher?.close();
    clearTimeout(refreshTimer);
    service.disconnect();
    legacy.disconnect();
  });
}
