import { contextBridge, ipcRenderer } from "electron";

type Status = {
  state: string;
  nodeId: string;
  host: string;
  port: number;
  message?: string;
};

type Unsubscribe = () => void;

type Api = {
  getInitialStatus: () => Promise<Status>;
  onStatus: (fn: (status: Status) => void) => Unsubscribe;
};

const api: Api = {
  getInitialStatus: async () => {
    return (await ipcRenderer.invoke("status.get")) as Status;
  },
  onStatus: (fn) => {
    const listener = (_evt: unknown, status: Status) => fn(status);
    ipcRenderer.on("status.update", listener);
    return () => ipcRenderer.off("status.update", listener);
  },
};

contextBridge.exposeInMainWorld("clawdbotLinuxNode", api);
