import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const service = new Service(path.join(app.getPath("userData"), "service"));
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
    publish({ event: "store", ...cached, storeError });
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
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
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
      await service.connect();
      await refresh();
      service.on("event", publish);
      service.on("disconnected", () =>
        publish({
          event: "error",
          message:
            "Terminal service disconnected. Reopen the preview to reconnect.",
        }),
      );
      handle("snapshot", async () => ({
        ...cached,
        storeError,
        terminals: await service.call("list"),
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
      handle("replay", (id) => service.call("replay", { id }));
      handle("write", (id, data) => service.call("write", { id, data }));
      handle("resize", (id, cols, rows) =>
        service.call("resize", { id, cols, rows }),
      );
      handle("close", async (id) => {
        const terminal = (await service.call("list")).find((t) => t.id === id);
        if (!terminal) return true;
        if (terminal.exited) {
          await service.call("close", { id });
          return true;
        }
        const isAgent = terminal.agent !== "shell";
        const result = await dialog.showMessageBox(window, {
          type: "question",
          message: isAgent ? "End this AI session?" : "Close this terminal?",
          detail: isAgent
            ? "This stops the agent process. To keep it running, cancel and close only its tab."
            : "Any process running in this terminal will be stopped.",
          buttons: ["Cancel", isAgent ? "End session" : "Close terminal"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 1) {
          await service.call("close", { id });
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
    watcher?.close();
    clearTimeout(refreshTimer);
    service.disconnect();
  });
}
