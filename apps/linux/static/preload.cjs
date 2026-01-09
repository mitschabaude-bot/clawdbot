const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getInitialStatus: async () => {
    return await ipcRenderer.invoke("status.get");
  },
  onStatus: (fn) => {
    const listener = (_evt, status) => fn(status);
    ipcRenderer.on("status.update", listener);
    return () => ipcRenderer.off("status.update", listener);
  },
};

contextBridge.exposeInMainWorld("clawdbotLinuxNode", api);
