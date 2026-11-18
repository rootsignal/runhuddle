const { contextBridge, ipcRenderer } = require("electron");
const invoke = (method, ...args) => ipcRenderer.invoke(method, ...args);
contextBridge.exposeInMainWorld("runhuddle", {
  usage: provider => invoke("usage", provider),
  connectClaudeUsage: enable => invoke("claude-usage-connect", enable),
  editors: () => invoke("editors"),
  chooseEditor: () => invoke("choose-editor"),
  openEditor: (id, target, line) => invoke("open-editor", id, target, line),
  watchGit: (cwd) => invoke("watch-git", cwd),
  gitAction: (cwd, action, input) => invoke("git-action", cwd, action, input),
  noteAction: (id, action) => ipcRenderer.invoke("note-action", id, action),
  saveNote: (draft) => invoke("save-note", draft),
  generateRecap: (provider, id, agent) => invoke("generate-recap", provider, id, agent),
  cancelRecap: (provider, id) => invoke("cancel-recap", provider, id),
  history: (provider, id, anchor) => invoke("history", provider, id, anchor),
  searchHistory: (query, folder, scope, refresh) => invoke("history-search", query, folder, scope, refresh),
  cancelHistorySearch: () => invoke("history-search-cancel"),
  openFolder: (cwd, target) => invoke("open-folder", cwd, target),
  gitChanges: (cwd, mode, revision) =>
    invoke("git-changes", cwd, mode, revision),
  gitDiff: (cwd, file, area, mode, revision) =>
    invoke("git-diff", cwd, file, area, mode, revision),
  reconnect: () => invoke("reconnect"),
  screenshotPath: (id) => invoke("screenshot-path", id),
  browserState: () => invoke("browser-state"),
  browserLayout: (rect) => invoke("browser-layout", rect),
  navigateBrowser: (url) => invoke("browser-navigate", url),
  browserAction: (action) => invoke("browser-action", action),
  browserAgent: (id) => invoke("browser-agent", id),
  captureBrowser: () => invoke("browser-capture"),
  copyScreenshotPath: (id) => invoke("copy-screenshot-path", id),
  setAppAccent: (accent) => invoke("set-app-accent", accent),
  snapshot: () => invoke("snapshot"),
  reopenBrowserSession: (id) => invoke("reopen-browser-session", id),
  locateCodexSession: (id) => invoke("locate-codex-session", id),
  viewedTerminal: (id) => invoke("viewed-terminal", id),
  inboxAction: (id, action) => invoke("inbox-action", id, action),
  chooseFolder: () => invoke("choose-folder"),
  create: (cwd, agent) => invoke("create", cwd, agent),
  pinSession: (provider, id, pinned) => invoke("pin-session", provider, id, pinned),
  title: (id, title) => invoke("title", id, title),
  resume: (provider, id) => invoke("resume", provider, id),
  archive: (provider, id, archived) =>
    invoke("archive", provider, id, archived),
  replay: (id) => invoke("replay", id),
  write: (id, data) => invoke("write", id, data),
  resize: (id, cols, rows) => invoke("resize", id, cols, rows),
  close: (id) => invoke("close", id),
  onEvent: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on("event", listener);
    return () => ipcRenderer.removeListener("event", listener);
  },
});
