import electronUpdater from "electron-updater";
import { createUpdateCheck, terminalUpdateBlocker } from "./app-updates.mjs";
import { usageService, configureClaudeRelay } from "./usage.mjs";
import {
  app,
  BrowserWindow,
  dialog,
  clipboard,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  shell,
} from "electron";
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TerminalInventory } from "./terminal-inventory.mjs";
import { editorService } from "./editors.mjs";
import { gitChanges, gitDiff, gitAction, watchRepository } from "./git.mjs";
import { Service } from "./service.mjs";
import { screenshotMonitor } from "./screenshots.mjs";
import { browserAgentBridge } from "./browser-agent-bridge.mjs";
import { codexLockOwner } from "./codex-lock-owner.mjs";
import { browserPreview } from "./browser-preview.mjs";
import { notesStore } from "./notes.mjs";
import { createSessionAlerts } from "./session-alerts.mjs";
import { createInbox } from "./inbox.mjs";
import { generateRecap, recapStore } from "./recaps.mjs";
import { historyIndexClient } from "./history-index-client.mjs";
import { providers, validateID } from "./lifecycle.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
app.setName("RunHuddle");
app.setPath(
  "userData",
  process.env.RUNHUDDLE_DATA ||
    process.env.RUNHUDDLE_PREVIEW_DATA ||
    path.join(app.getPath("appData"), "RunHuddle Preview"),
);
const appearanceFile = path.join(app.getPath("userData"), "app-appearance.json");
const themeChoices = ["system", "light", "dark"];
const accentChoices = {
  Teal: "#8fcbd0", Blue: "#87b9ee", Violet: "#b6a0ed", Amber: "#e5b75d",
  Green: "#8bc8a0", Rose: "#ea9eae", Orange: "#f1ac89", Indigo: "#a0a9ef",
};
const validAccent = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
let appAppearance = { theme: "system", accent: accentChoices.Teal };
let updateDownload = null;
try {
  const saved = JSON.parse(fs.readFileSync(appearanceFile, "utf8"));
  if (themeChoices.includes(saved.theme)) appAppearance.theme = saved.theme;
  if (validAccent(saved.accent)) appAppearance.accent = saved.accent.toLowerCase();
} catch {}
function saveAppAppearance(next) {
  fs.mkdirSync(path.dirname(appearanceFile), { recursive: true });
  fs.writeFileSync(appearanceFile + ".tmp", JSON.stringify(next), { mode: 0o600 });
  fs.renameSync(appearanceFile + ".tmp", appearanceFile);
  appAppearance = next;
}
function setAppAccent(accent) {
  if (!validAccent(accent)) throw Error("Choose a six-digit accent color.");
  saveAppAppearance({ ...appAppearance, accent: accent.toLowerCase() });
  for (const [label, value] of Object.entries(accentChoices)) {
    const item = Menu.getApplicationMenu()?.getMenuItemById("app-accent-" + label);
    if (item) item.checked = appAppearance.accent === value;
  }
  publish({ event: "app-accent", accent: appAppearance.accent });
}
const windowBackground = () => nativeTheme.shouldUseDarkColors ? "#18181b" : "#f3f5f7";
const editors = editorService(path.join(app.getPath("userData"), "editor.json"));
let stopGitWatch = () => {};
let gitWatchGeneration = 0;
const usageDirectory = path.join(app.getPath("userData"), "usage");
const readUsage = usageService(usageDirectory);
const service = new Service(path.join(app.getPath("userData"), "service-v2"));
const inventory = new TerminalInventory(
  path.join(app.getPath("userData"), "terminal-inventory.json"),
);
const noteStore = notesStore(path.join(app.getPath("userData"), "notes", "notes.sqlite"));
const savedRecaps = recapStore(path.join(app.getPath("userData"), "recaps", "recaps.sqlite"));
let recaps = {};
let recapRequest;
let notes = [];
let connection = "connected",
  quitting = false,
  recovering;
let updateBrowserService = () => {};
let updatingBrowserService;
let launchingTerminals = 0;
let reopeningForBrowser = false;
async function createTerminal(args, browserReopen = false) {
  if (reopeningForBrowser && !browserReopen) throw Error("Wait for the session to finish reopening.");
  if (updatingBrowserService) await updatingBrowserService;
  launchingTerminals++;
  try {
    return await service.call("create", args);
  } finally {
    launchingTerminals--;
    updateBrowserService();
  }
}
let ledgerSessions = [], providerSessions = [], managed = [];
let providerHistoryWorker, providerHistoryScanning = false, lastProviderHistoryScan = 0;
const sessionKey = (row) => row.provider + ":" + row.sessionID;
function mergeSessionHistory() {
  const sessions = new Map(providerSessions.map((row) => [sessionKey(row), row]));
  // A helper from an earlier release can keep running across an update.
  for (const row of ledgerSessions) {
    sessions.set(sessionKey(row), row.state === "archived" ? { ...row, state: "saved" } : row);
  }
  managed = [...sessions.values()];
}
function refreshProviderHistory() {
  if (quitting || providerHistoryScanning || Date.now() - lastProviderHistoryScan < 5000) return;
  if (!providerHistoryWorker) {
    const worker = new Worker(path.join(root, "provider-history.mjs"));
    providerHistoryWorker = worker;
    worker.on("exit", () => {
      providerHistoryWorker = undefined;
      providerHistoryScanning = false;
    });
    worker.on("error", () => {});
    worker.on("message", ({ rows }) => {
      providerHistoryScanning = false;
      if (!rows || quitting) return;
      providerSessions = rows;
      mergeSessionHistory();
      publishStore();
    });
  }
  providerHistoryScanning = true;
  lastProviderHistoryScan = Date.now();
  providerHistoryWorker.postMessage(null);
}
let ownedIds = new Set();
const allTerminals = async () => {
  const rows = await service.call("list");
  ownedIds = new Set(rows.map((t) => t.id));
  return inventory.reconcile(rows);
};
const pinsFile = path.join(app.getPath("userData"), "pinned-sessions.json");
const cleanupFile = path.join(app.getPath("userData"), "hidden-history.json");
const continuationsFile = path.join(app.getPath("userData"), "session-continuations.json");
let continuations = [];
try {
  const saved = JSON.parse(fs.readFileSync(continuationsFile, "utf8"));
  if (Array.isArray(saved)) {
    continuations = saved.filter((link) => link?.from?.sessionID && link?.to?.sessionID && Number.isFinite(link.createdAt));
  }
} catch {}
let hidden = { projects: [], sessions: [] };
try {
  const saved = JSON.parse(fs.readFileSync(cleanupFile, "utf8"));
  for (const kind of ["projects", "sessions"]) {
    if (Array.isArray(saved[kind])) hidden[kind] = saved[kind].filter((id) => typeof id === "string");
  }
} catch {}
let pinned = [];
try {
  const existing = JSON.parse(fs.readFileSync(pinsFile, "utf8"));
  if (Array.isArray(existing)) pinned = existing.filter((id) => typeof id === "string");
} catch {}

const publishStore = () => {
  scheduleHistoryIndex();
  publish({
    event: "store",
    sessions: managed,
    pinned,
    hidden,
    notes,
  });
};
async function serviceEvent(event) {
  if (event.event === "terminals") {
    const terminals = await allTerminals();
    if (viewedTerminal && !terminals.some((row) => row.id === viewedTerminal && !row.exited))
      browserAgent.revoke();
    publish({ ...event, terminals });
    publishStore();
    updateBrowserService();
  } else if (event.event === "history") {
    ledgerSessions = event.sessions;
    mergeSessionHistory();
    publishStore();
    if (connection === "connected") {
      inbox.sync(ledgerSessions);
      sessionAlerts.update(ledgerSessions);
    }
  } else publish(event);
}

const documentURL = pathToFileURL(path.join(root, "../dist/index.html")).href;
let window;
const publish = (event) => {
  if (window && !window.isDestroyed()) window.webContents.send("event", event);
};
const inbox = createInbox(path.join(app.getPath("userData"), "inbox.json"),
  (entries) => publish({ event: "inbox", entries }));
const alertPreference = path.join(app.getPath("userData"), "hide-session-alerts");
const alertIcon = app.isPackaged
  ? path.join(process.resourcesPath, "runhuddle-icon.png")
  : path.join(root, "../assets/icon.png");
const activeAlerts = new Map();
let viewedTerminal = null;
let pendingAlertSession;
let alertRendererReady = false;

function clearInboxCompletion(id) {
  if (!id) return;
  try {
    inbox.dismiss(id);
  } catch (error) {
    publish({ event: "error", message: "Could not update the Inbox: " + error.message });
  }
}

function openAlertSession(target) {
  if (!target || quitting) return;
  clearInboxCompletion(target.inboxId);
  const { provider, sessionID } = target;
  target = { provider, sessionID };
  if (!window || window.isDestroyed()) createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (alertRendererReady && !window.webContents.isLoadingMainFrame()) {
    publish({ event: "open-alert-session", target });
  } else pendingAlertSession = target;
}

function dismissSessionAlert(key) {
  const active = activeAlerts.get(key);
  activeAlerts.delete(key);
  active?.notification.close();
  publish({ event: "dismiss-session-alert", key });
}

function showSessionAlert(key, alert, test = false) {
  if (!test && !sessionAlertsEnabled) return;
  dismissSessionAlert(key);
  const fallback = () => publish({ event: "session-alert", key, alert });
  if (!Notification.isSupported()) return fallback();
  try {
    const notification = new Notification({
      title: alert.title,
      body: alert.body,
      icon: alertIcon,
      silent: true,
    });
    activeAlerts.set(key, { notification, inboxId: alert.inboxId });
    notification.once("click", () => {
      if (!test) openAlertSession(alert);
      else window?.focus();
    });
    const clear = () => {
      if (activeAlerts.get(key)?.notification === notification) activeAlerts.delete(key);
    };
    notification.once("close", clear);
    notification.once("failed", () => {
      if (activeAlerts.get(key)?.notification !== notification) return;
      clear();
      fallback();
    });
    if (activeAlerts.size > 32) dismissSessionAlert(activeAlerts.keys().next().value);
    notification.show();
  } catch {
    activeAlerts.delete(key);
    fallback();
  }
}
let sessionAlertsEnabled = !fs.existsSync(alertPreference);
const sessionAlerts = createSessionAlerts({
  isViewing: (id) => viewedTerminal === id && window?.isFocused(),
  deliver: (key, alert, kind) => {
    if (kind === "completion") {
      try { alert.inboxId = inbox.complete(alert); } catch (error) {
        publish({ event: "error", message: "Could not save the Inbox alert: " + error.message });
      }
    }
    showSessionAlert(key, alert);
  },
  dismiss: dismissSessionAlert,
});
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
const historyIndex = historyIndexClient(
  path.join(app.getPath("userData"), "history-index", "search.sqlite"),
  () => publish({ event: "history-index-updated" }),
);
let historySyncTimer;
let historySearch;
let searchGeneration = 0;
function stopHistorySearch() {
  searchGeneration++;
  historyIndex.cancel();
  if (historySearch) void historySearch.terminate();
  historySearch = undefined;
}

const historySource = ({ provider, sessionID, cwd, title, updated }) =>
  ({ provider, sessionID, cwd, title, updated });
const historyProviders = new Set(["Codex", "Claude", "Copilot"]);
const hasHistory = (row) => !row.simulated && historyProviders.has(row.provider);
function scheduleHistoryIndex() {
  if (quitting) return;
  historySyncTimer ??= setTimeout(() => {
    historySyncTimer = undefined;
    historyIndex.sync(managed.filter(hasHistory).map(historySource), true);
  }, 500);
}

function runHistoryWorker(workerData, timeout) {
  const worker = new Worker(path.join(root, "history-worker.mjs"), { workerData });
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(Error("History read timed out"));
    }, timeout);
    worker.once("message", (message) => {
      clearTimeout(timer);
      if (message.error) reject(Error(message.error));
      else resolve(message.result);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      reject(Error("History reader stopped"));
    });
  });
  return { worker, result };
}

let previewBrowser;
const canUseBrowser = (id) => connection === "connected" && viewedTerminal === id && ownedIds.has(id);
const browserAgent = browserAgentBridge(service.directory, () => previewBrowser, canUseBrowser);
function createWindow() {
  viewedTerminal = null;
  alertRendererReady = false;
  window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 550,
    backgroundColor: windowBackground(),
    title: "RunHuddle",
    webPreferences: {
      preload: path.join(root, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  previewBrowser = browserPreview(window, publish, app.getPath("temp"), browserAgent.revoke);
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("did-start-loading", () => {
    browserAgent.revoke();
    previewBrowser.layout(null);
    viewedTerminal = null;
    alertRendererReady = false;
  });
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

  window.on("close", () => {
    browserAgent.revoke();
    previewBrowser?.close();
  });
  window.on("closed", () => {
    previewBrowser = undefined;
    window = undefined;
    viewedTerminal = null;
  });
  window.on("focus", screenshots.refresh);
  window.on("focus", refreshProviderHistory);
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
      if (process.platform === "win32")
        app.setAppUserModelId("io.rootsignal.runhuddle.preview");
      nativeTheme.themeSource = appAppearance.theme;
      nativeTheme.on("updated", () => window?.setBackgroundColor(windowBackground()));
      await service.connect();
      ledgerSessions = await service.call("sessions");
      mergeSessionHistory();
      sessionAlerts.seed(ledgerSessions);
      inbox.sync(ledgerSessions);
      try { notes = noteStore.list(); } catch {}
      try { recaps = savedRecaps.list(); } catch {}
      scheduleHistoryIndex();
      await allTerminals();
      service.on("event", (event) => serviceEvent(event).catch(() => {}));
      async function recover() {
        if (quitting) return;
        if (recovering) return recovering;
        browserAgent.revoke();
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
              ledgerSessions = await service.call("sessions");
              mergeSessionHistory();
              sessionAlerts.seed(ledgerSessions);
              inbox.sync(ledgerSessions);
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
      updateBrowserService = () => {
        if (quitting || service.hello?.browserTools || recovering || updatingBrowserService ||
            launchingTerminals || inventory.rows.some((row) => ownedIds.has(row.id) && !row.exited)) return;
        updatingBrowserService = (async () => {
          // Recheck the service immediately before stopping it. New launches
          // through this window wait for the replacement service.
          const rows = await service.call("list");
          if (quitting || rows.some((row) => !row.exited)) return;
          await service.call("shutdown");
          await recover();
        })().catch(() => {}).finally(() => {
          updatingBrowserService = undefined;
        });
      };
      service.on("disconnected", recover);
      updateBrowserService();
      if (updatingBrowserService) await updatingBrowserService;
      handle("reconnect", recover);
      handle("set-app-accent", setAppAccent);
      handle("viewed-terminal", (id) => {
        const next = typeof id === "string" && id.length < 128 ? id : null;
        if (next !== viewedTerminal) browserAgent.revoke();
        viewedTerminal = next;
      });
      handle("inbox-action", (id, action) => {
        const entry = inbox.list().find((row) => row.id === id);
        if (!entry) return false;
        if (action === "open") {
          openAlertSession({ ...entry, inboxId: entry.kind === "completion" ? id : undefined });
        } else if (action === "dismiss" && entry.kind === "completion") {
          inbox.dismiss(id);
          const key = entry.provider + ":" + entry.sessionID;
          if (activeAlerts.get(key)?.inboxId === id) dismissSessionAlert(key);
        }
        return true;
      });
      handle("screenshot-path", (id) => screenshots.file(id));
      handle("browser-state", () => previewBrowser.state());
      handle("browser-layout", (rect) => previewBrowser.layout(rect));
      handle("browser-navigate", (url) => previewBrowser.navigate(url));
      handle("browser-action", (action) => previewBrowser.action(action));
      handle("browser-capture", () => previewBrowser.capture());
      handle("browser-agent", async (id) => {
        if (id === null) return browserAgent.revoke();
        if (!canUseBrowser(id)) throw Error("Select an AI session opened in this version of RunHuddle.");
        await browserAgent.allow(id, () => service.call("browser-key", { id }));
      });
      handle("copy-screenshot-path", async (id) => {
        clipboard.writeText(await screenshots.file(id));
      });
      handle("snapshot", async () => {
        const terminals =
          connection === "connected" ? await allTerminals() : inventory.rows;
        const openAlert = pendingAlertSession;
        pendingAlertSession = undefined;
        alertRendererReady = true;
        return {
          appTheme: appAppearance.theme,
          accent: appAppearance.accent,
          updateDownload,
          pinned,
          hidden,
          continuations,
          sessions: managed,
          notes,
          terminals,
          connection,
          openAlert,
          inbox: inbox.list(),
          recaps,
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
        const source = draft?.source && managed.find((session) =>
          session.provider === draft.source.provider &&
          session.sessionID === draft.source.sessionID);
        if (draft?.source && !source) throw Error("The source session is no longer available.");
        const note = noteStore.save(draft, previous, source);
        notes = [note, ...notes.filter((n) => n.id !== note.id)];
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
      handle("history", (provider, sessionID, anchor) => {
        const row = managed.find(
          (s) => s.provider === provider && s.sessionID === sessionID,
        );
        if (!row || row.simulated) throw Error("Session not available");
        if (anchor && (!Number.isSafeInteger(anchor.offset) || anchor.offset < 0 ||
            anchor.offset > Number.MAX_SAFE_INTEGER - 8 * 1024 * 1024 ||
            !Number.isSafeInteger(anchor.textOffset) || anchor.textOffset < 0 ||
            typeof anchor.fingerprint !== "string" || !/^[0-9a-f]{24}$/.test(anchor.fingerprint))) {
          throw Error("Invalid conversation match");
        }
        return runHistoryWorker({ session: historySource(row), anchor }, 10000).result;
      });
      handle("generate-recap", async (provider, sessionID, agent) => {
        if (recapRequest) throw Error("A recap is already being generated.");
        const row = managed.find((session) =>
          session.provider === provider && session.sessionID === sessionID && hasHistory(session),
        );
        if (!row) throw Error("Session not available");
        const key = provider + ":" + sessionID;
        const controller = new AbortController();
        recapRequest = { key, controller };
        try {
          const recap = await generateRecap(row, agent, controller.signal);
          controller.signal.throwIfAborted();
          savedRecaps.save(key, recap);
          recaps[key] = recap;
          publish({ event: "recap", key, recap });
          return recap;
        } finally {
          recapRequest = undefined;
        }
      });
      handle("cancel-recap", (provider, sessionID) => {
        if (recapRequest?.key === provider + ":" + sessionID)
          recapRequest.controller.abort();
      });
      handle("history-search", async (query, folder, scope, refresh) => {
        stopHistorySearch();
        if (typeof query !== "string" || query.trim().length < 2 || query.length > 120)
          return { results: [], incomplete: false };
        const pins = new Set(pinned);
        const hiddenProjects = new Set(hidden.projects);
        const hiddenSessions = new Set(hidden.sessions);
        const generation = searchGeneration;
        const sessions = managed.filter((row) =>
          hasHistory(row) &&
          !hiddenProjects.has(row.cwd) && !hiddenSessions.has(sessionKey(row)) &&
          (!folder || row.cwd === folder) &&
          (scope !== "pinned" || pins.has(sessionKey(row))),
        ).sort((a, b) => b.updated - a.updated).map(historySource);
        const indexed = historyIndex.search(sessions, query, refresh !== false);
        if (indexed) {
          try {
            return await indexed;
          } catch {
            if (generation !== searchGeneration) return { results: [], incomplete: false };
          }
        }
        const search = runHistoryWorker({ sessions, query }, 18000);
        historySearch = search.worker;
        return search.result.finally(() => {
          if (historySearch === search.worker) historySearch = undefined;
        });
      });
      handle("history-search-cancel", stopHistorySearch);
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
      handle("create", (cwd, agent) => createTerminal({ cwd, agent }));
      handle("resume", async (provider, sessionID) => {
        const row = managed.find(
          (s) => s.provider === provider && s.sessionID === sessionID,
        );
        if (!row || row.simulated) throw Error("Session not available");
        const agent = provider.toLowerCase();
        const existing = (await allTerminals()).find(
          (t) => t.agent === agent && t.sessionID === sessionID && !t.exited,
        );
        if (existing) return existing;
        return createTerminal({
          cwd: row.cwd,
          agent,
          resume: sessionID,
        });
      });
      handle("title", async (id, title) => {
        if (ownedIds.has(id)) await service.call("title", { id, title });
      });
      handle("set-history-hidden", async (kind, id, hide) => {
        if ((kind !== "projects" && kind !== "sessions") || typeof id !== "string" ||
            typeof hide !== "boolean" || (kind === "projects" && !path.isAbsolute(id)))
          throw Error("Invalid cleanup selection.");
        if (hide) {
          const session = kind === "sessions" ? managed.find((row) => sessionKey(row) === id) : undefined;
          if (kind === "sessions" && !session) throw Error("Session not available.");
          const terminals = connection === "connected" ? await allTerminals() : inventory.rows;
          const running = terminals.some((t) => !t.exited && (session
            ? t.id === session.terminalId || (t.agent === session.provider.toLowerCase() && t.sessionID === session.sessionID)
            : t.cwd === id));
          if (running) throw Error(session ? "End the running session before hiding it." : "End this project’s running terminals before hiding it.");
        }
        const ids = new Set(hidden[kind]);
        if (hide) ids.add(id);
        else ids.delete(id);
        const next = { ...hidden, [kind]: [...ids] };
        fs.writeFileSync(cleanupFile + ".tmp", JSON.stringify(next), { mode: 0o600 });
        fs.renameSync(cleanupFile + ".tmp", cleanupFile);
        hidden = next;
        publishStore();
      });
      handle("pin-session", (provider, sessionID, shouldPin) => {
        if (typeof shouldPin !== "boolean" || !managed.some((row) => row.provider === provider && row.sessionID === sessionID))
          throw Error("Session not available");
        const id = provider + ":" + sessionID;
        const next = pinned.filter((key) => key !== id);
        if (shouldPin) next.push(id);
        fs.writeFileSync(pinsFile + ".tmp", JSON.stringify(next), { mode: 0o600 });
        fs.renameSync(pinsFile + ".tmp", pinsFile);
        pinned = next;
        publishStore();
      });
      handle("record-session-continuation", (from, to, title) => {
        const source = managed.find((row) => row.provider === from?.provider && row.sessionID === from?.sessionID);
        if (!source || !Object.values(providers).includes(to?.provider)) return false;
        validateID(to.sessionID);
        if (sessionKey(source) === sessionKey(to)) return false;
        const target = managed.find((row) => sessionKey(row) === sessionKey(to));
        const link = {
          from: { provider: source.provider, sessionID: source.sessionID, title: source.title },
          to: { provider: to.provider, sessionID: to.sessionID,
            title: target?.title || (typeof title === "string" && title.slice(0, 120)) || `${to.provider} session` },
          createdAt: Date.now(),
        };
        const next = [link, ...continuations.filter((existing) =>
          sessionKey(existing.from) !== sessionKey(from) || sessionKey(existing.to) !== sessionKey(to))];
        fs.writeFileSync(continuationsFile + ".tmp", JSON.stringify(next), { mode: 0o600 });
        fs.renameSync(continuationsFile + ".tmp", continuationsFile);
        continuations = next;
        publish({ event: "session-continuations", continuations });
        return true;
      });
      handle("replay", (id) => service.call("replay", { id }));
      handle("write", async (id, data) =>
        service.call("write", { id, data }),
      );
      handle("resize", async (id, cols, rows) =>
        service.call("resize", { id, cols, rows }),
      );
      handle("reopen-browser-session", async (id) => {
        if (reopeningForBrowser) throw Error("A session is already being reopened.");
        reopeningForBrowser = true;
        try {
          const rows = await allTerminals();
          const terminal = rows.find((row) => row.id === id && !row.exited && row.agent !== "shell");
          if (!terminal || terminal.browserTools) throw Error("Select an older AI session in RunHuddle.");
          const conflicts = (current) => !service.hello?.browserTools &&
            current.filter((row) => ownedIds.has(row.id) && !row.exited && (row.id !== id || !terminal.sessionID));
          function checkOtherTerminals(current) {
            const older = conflicts(current);
            if (older?.length || launchingTerminals) {
              const names = (older || []).map((row) => (row.title || path.basename(row.cwd)).slice(0, 80)).slice(0, 3);
              throw Error(names.length ? "These older RunHuddle terminals are still running: " + names.join(", ") + "." :
                "Wait for the other terminal to open, then try again.");
            }
          }
          checkOtherTerminals(rows);
          if (terminal.sessionID) {
            const answer = await dialog.showMessageBox(window, {
              type: "question",
              message: "Reopen this session with browser control?",
              detail: "RunHuddle will stop this terminal and reopen the saved conversation with browser tools.",
              buttons: ["Cancel", "Reopen session"],
              defaultId: 0,
              cancelId: 0,
            });
            if (answer.response !== 1) return null;
            const current = await allTerminals();
            if (!current.some((row) => row.id === id && !row.exited))
              throw Error("The selected terminal already ended. Reopen its saved conversation from the sidebar.");
            checkOtherTerminals(current);
            await service.call("close", { id });
            inventory.forget(id);
          }
          if (!service.hello?.browserTools) {
            if (!updatingBrowserService) {
              await allTerminals();
              updateBrowserService();
            }
            if (updatingBrowserService) await updatingBrowserService;
            if (!service.hello?.browserTools) throw Error("RunHuddle couldn’t update the terminal service. Try again after the older terminals have ended.");
          }
          return createTerminal({ cwd: terminal.cwd, agent: terminal.agent, resume: terminal.sessionID }, true);
        } finally {
          reopeningForBrowser = false;
        }
      });
      handle("locate-codex-session", async (id) => {
        const terminal = (await allTerminals()).find((row) => row.id === id && !row.exited && row.agent === "codex");
        if (!terminal) return;
        const owner = await codexLockOwner(terminal.sessionID);
        if (!window || window.isDestroyed()) return;
        await dialog.showMessageBox(window, {
          type: "info",
          message: owner ? `The conversation is open in ${owner}.` : "Codex reported that this conversation is in use elsewhere.",
          detail: owner
            ? owner === "RunHuddle"
              ? "Check the RunHuddle tabs for this conversation. If the terminal still shows the lock prompt, press R to retry."
              : "Exit this conversation there, then press R in the RunHuddle terminal to retry. Closing a tab can leave its session running."
            : "Press R in the RunHuddle terminal to retry. If it’s still locked, check for the conversation in the Codex app, another terminal, or another RunHuddle window.",
          buttons: ["OK"],
        });
      });
      handle("close", async (id) => {
        const terminal = (await allTerminals()).find((t) => t.id === id);
        if (!terminal) return true;
        if (terminal.unavailable) {
          inventory.forget(id);
          publish({ event: "terminals", terminals: inventory.rows });
          return true;
        }
        if (terminal.exited) {
          inventory.forget(id);
          await service.call("close", { id });
          return true;
        }
        const isAgent = terminal.agent !== "shell";
        const result = await dialog.showMessageBox(window, {
          type: "question",
          message: isAgent ? "End this AI session?" : "Close this terminal?",
          detail: isAgent
            ? "This stops the agent terminal. The saved conversation stays in your history."
            : "Any process running in this terminal will be stopped.",
          buttons: ["Cancel", isAgent ? "End session" : "Close terminal"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 1) {
          inventory.forget(id);
          await service.call("close", { id });
          return true;
        }
        return false;
      });
      const checkForUpdates = createUpdateCheck({
        app, dialog, updater: electronUpdater.autoUpdater, windowForDialog: () => window,
        supported: process.platform !== "linux" || !!process.env.APPIMAGE,
        onDownloadProgress: (download) => {
          updateDownload = download;
          publish({ event: "update-download", download });
        },
        installBlocker: async () => {
          if (connection !== "connected" || launchingTerminals)
            return "Wait for RunHuddle to finish connecting to its terminals before installing.";
          const [terminals, sessions] = await Promise.all([service.call("list"), service.call("sessions")]);
          return terminalUpdateBlocker(terminals, sessions, process.platform);
        },
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "RunHuddle",
            submenu: [
              { label: "About RunHuddle", role: "about" },
              { id: "check-for-updates", label: "Check for Updates…", click: () => void checkForUpdates() },
              { type: "separator" },
              {
                label: "Quit RunHuddle (keep terminals running)",
                accelerator: "CmdOrCtrl+Q",
                click: () => app.quit(),
              },
              {
                label: "Quit and stop all terminals…",
                click: async () => {
                  const result = await dialog.showMessageBox(window, {
                    type: "question",
                    message: "Stop all terminals and quit?",
                    buttons: ["Cancel", "Stop and quit"],
                    defaultId: 0,
                    cancelId: 0,
                  });
                  if (result.response === 1) {
                    quitting = true;
                    await service.call("shutdown");
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
              {
                label: "App Theme",
                submenu: themeChoices.map((theme) => ({
                  id: "app-theme-" + theme,
                  label: theme[0].toUpperCase() + theme.slice(1),
                  type: "radio",
                  checked: appAppearance.theme === theme,
                  click: () => {
                    saveAppAppearance({ ...appAppearance, theme });
                    nativeTheme.themeSource = theme;
                    publish({ event: "app-theme", theme });
                  },
                })),
              },
              {
                label: "Accent Color",
                submenu: [
                  ...Object.entries(accentChoices).map(([label, accent]) => ({
                    id: "app-accent-" + label,
                    label,
                    type: "checkbox",
                    checked: appAppearance.accent === accent,
                    click: () => setAppAccent(accent),
                  })),
                  { type: "separator" },
                  { id: "custom-app-accent", label: "Custom Color…", click: () => publish({ event: "custom-app-accent" }) },
                ],
              },
              {
                label: "Session notifications",
                type: "checkbox",
                checked: sessionAlertsEnabled,
                click: ({ checked }) => {
                  sessionAlertsEnabled = checked;
                  if (checked) fs.rmSync(alertPreference, { force: true });
                  else {
                    fs.writeFileSync(alertPreference, "", { mode: 0o600 });
                    for (const key of activeAlerts.keys()) dismissSessionAlert(key);
                    publish({ event: "clear-session-alerts" });
                  }
                },
              },
              {
                label: "Send test notification",
                click: () => showSessionAlert("test", {
                  title: "RunHuddle",
                  body: "Session notifications are ready.",
                }, true),
              },
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
          {
            label: "Help",
            submenu: [{
              id: "getting-started",
              label: "Getting started",
              click: () => publish({ event: "getting-started" }),
            }],
          },
        ]),
      );
      createWindow();
      refreshProviderHistory();
      if (!fs.existsSync(screenshotPreference)) screenshots.enable();
      app.on("activate", () => {
        if (!window) createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox("RunHuddle could not start", error.message);
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    browserAgent.close();
    screenshots.stop();
    recapRequest?.controller.abort();
    stopHistorySearch();
    clearTimeout(historySyncTimer);
    void providerHistoryWorker?.terminate();
    void historyIndex.close();
    for (const key of activeAlerts.keys()) dismissSessionAlert(key);
    service.disconnect();
  });
}
