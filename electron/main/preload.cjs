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
  history: (provider, id) => invoke("history", provider, id),
  openFolder: (cwd, target) => invoke("open-folder", cwd, target),
  gitChanges: (cwd, mode, revision) =>
    invoke("git-changes", cwd, mode, revision),
  gitDiff: (cwd, file, area, mode, revision) =>
    invoke("git-diff", cwd, file, area, mode, revision),
  reconnect: () => invoke("reconnect"),
  screenshotPath: (id) => invoke("screenshot-path", id),
  copyScreenshotPath: (id) => invoke("copy-screenshot-path", id),
  snapshot: () => invoke("snapshot"),
  chooseFolder: () => invoke("choose-folder"),
  create: (cwd, agent) => invoke("create", cwd, agent),
  link: (provider, id, terminal) => invoke("link", provider, id, terminal),
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
