const { contextBridge, ipcRenderer } = require("electron");
const invoke = (method, ...args) => ipcRenderer.invoke(method, ...args);
contextBridge.exposeInMainWorld("runhuddle", {
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
