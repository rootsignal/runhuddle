import { usageService, configureClaudeRelay } from "./usage.mjs";
import {
  app,
  BrowserWindow,
  dialog,
  clipboard,
  ipcMain,
  Menu,
  shell,
} from "electron";
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mergeSessions } from "./lifecycle.mjs";
import { TerminalInventory } from "./terminal-inventory.mjs";
import { editorService } from "./editors.mjs";
import { gitChanges, gitDiff, gitAction, watchRepository } from "./git.mjs";
import { Service } from "./service.mjs";
import { screenshotMonitor } from "./screenshots.mjs";
import { notesStore } from "./notes.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
app.setName("RunHuddle Preview");
app.setPath(
  "userData",
  process.env.RUNHUDDLE_PREVIEW_DATA ||
    path.join(app.getPath("appData"), "RunHuddle Preview"),
);
const editors = editorService(path.join(app.getPath("userData"), "editor.json"));
let stopGitWatch = () => {};
let gitWatchGeneration = 0;
const usageDirectory = path.join(app.getPath("userData"), "usage");
const readUsage = usageService(usageDirectory);
const nativeStore =
  process.env.RUNHUDDLE_NATIVE_STORE ||
  path.join(app.getPath("appData"), "RunHuddle", "sessions.sqlite");
const service = new Service(path.join(app.getPath("userData"), "service-v2"));
const legacy = new Service(path.join(app.getPath("userData"), "service"));
const inventory = new TerminalInventory(
  path.join(app.getPath("userData"), "terminal-inventory.json"),
);
const noteStore = notesStore(path.join(app.getPath("userData"), "notes", "notes.sqlite"));
let localNotes = [];
let notes = [];
function mergeNotes() {
  const localIDs = new Set(localNotes.map((note) => note.id));
  notes = [...localNotes, ...cached.notes.filter((note) => !localIDs.has(note.id))];
}
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
    notes,
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
const screenshotPreference = path.join(app.getPath("userData"), "hide-screenshot-popups");
const screenshotFolderPreference = path.join(app.getPath("userData"), "screenshot-folder");
let screenshotFolder;
try {
  const saved = fs.readFileSync(screenshotFolderPreference, "utf8");
  if (path.isAbsolute(saved)) screenshotFolder = saved;
} catch {}
const screenshots = screenshotMonitor({
  desktop: app.getPath("desktop"),
  pictures: app.getPath("pictures"),
  home: os.homedir(),
  customFolder: () => screenshotFolder,
  publish,
});
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
    mergeNotes();
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
  window.on("focus", screenshots.refresh);
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
      try { localNotes = noteStore.list(); } catch {}
      mergeNotes();
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
      handle("screenshot-path", (id) => screenshots.file(id));
      handle("copy-screenshot-path", async (id) => {
        clipboard.writeText(await screenshots.file(id));
      });
      handle("snapshot", async () => {
        const terminals =
          connection === "connected" ? await allTerminals() : inventory.rows;
        return {
          ...cached,
          storeError,
          sessions: merged(),
          notes,
          terminals,
          connection,
          home: os.homedir(),
        };
      });
      handle("open-folder", async (cwd, target) => {
        if (
          typeof cwd !== "string" ||
          !path.isAbsolute(cwd) ||
          !fs.statSync(cwd).isDirectory()
        )
          throw new Error("Choose an existing project folder.");
        if (target === "folder") {
          const error = await shell.openPath(cwd);
          if (error) throw new Error(error);
        } else throw new Error("Unsupported folder action");
      });
      handle("save-note", (draft) => {
        const previous = draft?.id && notes.find((n) => n.id === draft.id);
        if (draft?.id && !previous) throw Error("Note not available");
        const source = draft?.source && merged().find((session) =>
          session.provider === draft.source.provider &&
          session.sessionID === draft.source.sessionID);
        if (draft?.source && !source) throw Error("The source session is no longer available.");
        const note = noteStore.save(draft, previous, source);
        localNotes = [note, ...localNotes.filter((n) => n.id !== note.id)];
        mergeNotes();
        publishStore();
        return note;
      });
      handle("note-action", async (id, action) => {
        const note = notes.find((n) => n.id === id);
        if (!note) throw new Error("Note not available");
        const text = `# ${note.title}\n\n${note.text}\n`;
        if (action === "copy") {
          clipboard.writeText(text);
          return;
        }
        if (action !== "export") throw new Error("Unknown note action");
        const result = await dialog.showSaveDialog(window, {
          title: "Export note",
          defaultPath:
            (note.title.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 100).trim() || "note") + ".md",
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (!result.canceled && result.filePath)
          await fs.promises.writeFile(result.filePath, text, "utf8");
      });
      handle("history", async (provider, sessionID) => {
        const row = [...managed, ...cached.sessions].find(
          (s) => s.provider === provider && s.sessionID === sessionID,
        );
        if (!row || row.simulated) throw new Error("Session not available");
        return new Promise((resolve, reject) => {
          const worker = new Worker(path.join(root, "history-worker.mjs"), {
            workerData: {
              provider: row.provider,
              sessionID: row.sessionID,
              cwd: row.cwd,
            },
          });
          const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error("History read timed out"));
          }, 10000);
          worker.once("message", (message) => {
            clearTimeout(timer);
            message.error
              ? reject(new Error(message.error))
              : resolve(message.result);
          });
          worker.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          worker.once("exit", () => {
            clearTimeout(timer);
            reject(
              new Error("History reader closed before returning a result"),
            );
          });
        });
      });
      handle("usage", readUsage);
      handle("claude-usage-connect", enable => configureClaudeRelay(usageDirectory, enable));
      handle("editors", () => editors.list());
      handle("choose-editor", async () => {
        const result = await dialog.showOpenDialog({
          title: "Choose an editor application",
          defaultPath: process.platform === "darwin" ? "/Applications" : undefined,
          properties: ["openFile"],
          ...(process.platform === "darwin" ? { filters: [{ name: "Applications", extensions: ["app"] }] } : {}),
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const application = result.filePaths[0];
        const editor = { id: "custom", name: path.basename(application).replace(/\.(app|exe)$/i, ""), application };
        editors.save(editor);
        return editors.list();
      });
      handle("open-editor", (id, target, line) => editors.open(id, target, line));
      handle("watch-git", async (cwd) => {
        const generation = ++gitWatchGeneration;
        stopGitWatch();
        const stop = await watchRepository(cwd, () => publish({ event: "git", cwd }));
        if (generation !== gitWatchGeneration) stop();
        else stopGitWatch = stop;
      });
      handle("git-action", gitAction);
      handle("git-changes", gitChanges);
      handle("git-diff", gitDiff);
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
              {
                label: "Screenshot popups",
                type: "checkbox",
                checked: !fs.existsSync(screenshotPreference),
                click: ({ checked }) => {
                  if (checked) {
                    fs.rmSync(screenshotPreference, { force: true });
                    screenshots.enable();
                  } else {
                    fs.writeFileSync(screenshotPreference, "", { mode: 0o600 });
                    screenshots.stop();
                    publish({ event: "screenshots-off" });
                  }
                },
              },
              {
                label: "Choose screenshot folder…",
                click: async () => {
                  const options = {
                    title: "Choose the folder where screenshots are saved",
                    defaultPath: screenshotFolder,
                    properties: ["openDirectory"],
                  };
                  const result = window
                    ? await dialog.showOpenDialog(window, options)
                    : await dialog.showOpenDialog(options);
                  if (result.canceled || !result.filePaths[0]) return;
                  screenshotFolder = result.filePaths[0];
                  fs.writeFileSync(screenshotFolderPreference, screenshotFolder, { mode: 0o600 });
                  void screenshots.refresh();
                },
              },
              {
                label: "Use system screenshot folders",
                click: () => {
                  fs.rmSync(screenshotFolderPreference, { force: true });
                  screenshotFolder = undefined;
                  void screenshots.refresh();
                },
              },
              { role: "togglefullscreen" },
            ],
          },
        ]),
      );
      createWindow();
      if (!fs.existsSync(screenshotPreference)) screenshots.enable();
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
    screenshots.stop();
    clearTimeout(refreshTimer);
    service.disconnect();
    legacy.disconnect();
  });
}
