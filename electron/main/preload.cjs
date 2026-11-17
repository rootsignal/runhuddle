const { contextBridge, ipcRenderer } = require("electron");
const invoke = (method, ...args) => ipcRenderer.invoke(method, ...args);
contextBridge.exposeInMainWorld("runhuddle", {
  snapshot: () => invoke("snapshot"),
  chooseFolder: () => invoke("choose-folder"),
  create: (cwd, agent) => invoke("create", cwd, agent),
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
