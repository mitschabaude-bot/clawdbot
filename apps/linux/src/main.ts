import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";

import { BridgeClient } from "./bridge/client.js";
import { loadAuth, saveAuth } from "./bridge/store.js";
import { systemRun } from "./commands/system-run.js";
import { systemNotify } from "./commands/system-notify.js";
import { screenRecord } from "./commands/screen-record.js";
import { cameraList, cameraSnap } from "./commands/camera.js";
import { CanvasManager } from "./ui/canvas-manager.js";

type Status = {
  state: string;
  nodeId: string;
  host: string;
  port: number;
  message?: string;
};

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--host") out.host = String(args[++i] ?? "");
    else if (a === "--port") out.port = String(args[++i] ?? "");
  }
  return {
    host: out.host?.trim() || process.env.CLAWDBOT_GATEWAY_HOST || "127.0.0.1",
    port: Number.parseInt(out.port || process.env.CLAWDBOT_GATEWAY_PORT || "7339", 10),
  };
}

function nowVersion() {
  return process.env.npm_package_version || "dev";
}

function buildDisplayName() {
  const user = os.userInfo().username;
  const host = os.hostname();
  return `Linux Node (${user}@${host})`;
}

async function main() {
  const { host, port } = parseArgs(process.argv);

  const existing = await loadAuth();
  const nodeId = existing?.nodeId ?? randomUUID();
  const token = existing?.token;
  if (!existing) {
    await saveAuth({ nodeId });
  }

  const canvas = new CanvasManager();
  const bridge = new BridgeClient();

  let lastStatus: Status = {
    state: "starting",
    nodeId,
    host,
    port,
    message: "",
  };

  const broadcastStatus = (patch: Partial<Status>) => {
    lastStatus = { ...lastStatus, ...patch };
    if (statusWin && !statusWin.isDestroyed()) {
      statusWin.webContents.send("status.update", lastStatus);
    }
  };

  let statusWin: BrowserWindow | null = null;

  const createStatusWindow = () => {
    statusWin = new BrowserWindow({
      width: 520,
      height: 260,
      webPreferences: {
        preload: path.join(import.meta.dirname, "ui", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    void statusWin.loadFile(path.join(import.meta.dirname, "..", "static", "index.html"));
    statusWin.on("closed", () => {
      statusWin = null;
    });
  };

  ipcMain.handle("status.get", async () => lastStatus);

  const resolveA2UIUrl = () => {
    const base = bridge.getCanvasHostUrl();
    if (!base) return null;
    const trimmed = base.trim();
    if (!trimmed) return null;
    const url = new URL("__clawdbot__/a2ui/", trimmed);
    url.searchParams.set("platform", "linux");
    return url.toString();
  };

  const ensureA2UIReady = async () => {
    const a2ui = resolveA2UIUrl();
    if (!a2ui) throw new Error("A2UI_HOST_NOT_CONFIGURED: gateway did not advertise canvas host");
    if (!canvas.isOpen()) {
      canvas.show({ url: a2ui });
    } else {
      await canvas.navigate(a2ui);
    }

    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      try {
        const ok = await canvas.evalJS("(() => String(Boolean(globalThis.clawdbotA2UI)))()");
        if (String(ok).trim() === "true") return;
      } catch {
        // ignore while loading
      }
      await new Promise<void>((r) => setTimeout(r, 120));
    }
    throw new Error("A2UI_HOST_UNAVAILABLE: A2UI host not reachable");
  };

  const onInvoke = async (req: { id: string; command: string; paramsJSON?: string | null }) => {
    const id = req.id;
    try {
      const params =
        typeof req.paramsJSON === "string" && req.paramsJSON.trim()
          ? (JSON.parse(req.paramsJSON) as unknown)
          : {};

      switch (req.command) {
        case "system.run": {
          const p = params as Record<string, unknown>;
          const result = await systemRun({
            command: (p.command as string[] | string) ?? [],
            cwd: typeof p.cwd === "string" ? p.cwd : undefined,
            env: p.env && typeof p.env === "object" ? (p.env as Record<string, string>) : undefined,
            timeoutMs: typeof p.timeoutMs === "number" ? p.timeoutMs : undefined,
          });
          return { id, ok: true, payloadJSON: JSON.stringify(result) };
        }
        case "system.notify": {
          const p = params as Record<string, unknown>;
          const res = await systemNotify({
            title: typeof p.title === "string" ? p.title : undefined,
            body: typeof p.body === "string" ? p.body : undefined,
          });
          if (!res.ok) {
            return { id, ok: false, error: { code: "UNAVAILABLE", message: res.error ?? "NOTIFY_FAILED" } };
          }
          return { id, ok: true };
        }
        case "screen.record": {
          const p = params as Record<string, unknown>;
          const payload = await screenRecord({
            screenIndex: typeof p.screenIndex === "number" ? p.screenIndex : undefined,
            durationMs: typeof p.durationMs === "number" ? p.durationMs : undefined,
            fps: typeof p.fps === "number" ? p.fps : undefined,
            format: typeof p.format === "string" ? p.format : "mp4",
            includeAudio: typeof p.includeAudio === "boolean" ? p.includeAudio : undefined,
          });
          return { id, ok: true, payloadJSON: JSON.stringify(payload) };
        }
        case "camera.list": {
          const payload = await cameraList();
          return { id, ok: true, payloadJSON: JSON.stringify(payload) };
        }
        case "camera.snap": {
          const p = params as Record<string, unknown>;
          const payload = await cameraSnap({
            deviceId: typeof p.deviceId === "string" ? p.deviceId : undefined,
            facing: p.facing === "front" || p.facing === "back" ? p.facing : undefined,
            maxWidth: typeof p.maxWidth === "number" ? p.maxWidth : undefined,
            quality: typeof p.quality === "number" ? p.quality : undefined,
            delayMs: typeof p.delayMs === "number" ? p.delayMs : undefined,
          });
          return { id, ok: true, payloadJSON: JSON.stringify(payload) };
        }
        case "canvas.present": {
          const p = params as Record<string, unknown>;
          const url = typeof p.url === "string" && p.url.trim() ? p.url.trim() : undefined;
          const placement =
            p.placement && typeof p.placement === "object"
              ? (p.placement as { x?: unknown; y?: unknown; width?: unknown; height?: unknown })
              : undefined;
          canvas.show({
            url,
            placement:
              placement &&
              typeof placement.x === "number" &&
              typeof placement.y === "number" &&
              typeof placement.width === "number" &&
              typeof placement.height === "number"
                ? {
                    x: placement.x,
                    y: placement.y,
                    width: placement.width,
                    height: placement.height,
                  }
                : undefined,
          });
          return { id, ok: true };
        }
        case "canvas.hide": {
          canvas.hide();
          return { id, ok: true };
        }
        case "canvas.navigate": {
          const p = params as Record<string, unknown>;
          const url = typeof p.url === "string" ? p.url : "";
          if (!url.trim()) {
            return { id, ok: false, error: { code: "INVALID_REQUEST", message: "INVALID_REQUEST: url required" } };
          }
          await canvas.navigate(url.trim());
          return { id, ok: true };
        }
        case "canvas.eval": {
          const p = params as Record<string, unknown>;
          const js = typeof p.javaScript === "string" ? p.javaScript : "";
          if (!js.trim()) {
            return { id, ok: false, error: { code: "INVALID_REQUEST", message: "INVALID_REQUEST: javaScript required" } };
          }
          const result = await canvas.evalJS(js);
          return { id, ok: true, payloadJSON: JSON.stringify({ result }) };
        }
        case "canvas.snapshot": {
          const p = params as Record<string, unknown>;
          const formatRaw = typeof p.format === "string" ? p.format.trim().toLowerCase() : "jpeg";
          const format = formatRaw === "png" ? "png" : "jpeg";
          const quality = typeof p.quality === "number" ? p.quality : 0.9;
          const payload = await canvas.snapshot({ format, quality });
          return { id, ok: true, payloadJSON: JSON.stringify(payload) };
        }
        case "canvas.a2ui.reset": {
          await ensureA2UIReady();
          const json = await canvas.evalJS(
            "(() => { if (!globalThis.clawdbotA2UI) return JSON.stringify({ ok: false, error: 'missing clawdbotA2UI' }); return JSON.stringify(globalThis.clawdbotA2UI.reset()); })()",
          );
          return { id, ok: true, payloadJSON: String(json) };
        }
        case "canvas.a2ui.push":
        case "canvas.a2ui.pushJSONL": {
          await ensureA2UIReady();
          const p = params as Record<string, unknown>;
          const jsonl = typeof p.jsonl === "string" ? p.jsonl : "";
          const rawMessages = Array.isArray(p.messages) ? p.messages : [];

          const decodeJSONL = (jsonl: string): unknown[] => {
            const lines = jsonl.split("\n").map((l) => l.trim()).filter(Boolean);
            const out: unknown[] = [];
            for (const line of lines) {
              out.push(JSON.parse(line) as unknown);
            }
            return out;
          };

          const effectiveMessages =
            req.command === "canvas.a2ui.pushJSONL" ? decodeJSONL(jsonl) : rawMessages;

          const js = `(() => { try { if (!globalThis.clawdbotA2UI) return JSON.stringify({ ok: false, error: 'missing clawdbotA2UI' }); const messages = ${JSON.stringify(
            effectiveMessages,
          )}; return JSON.stringify(globalThis.clawdbotA2UI.applyMessages(messages)); } catch (e) { return JSON.stringify({ ok: false, error: String(e?.message ?? e) }); } })()`;

          const resultJSON = await canvas.evalJS(js);
          return { id, ok: true, payloadJSON: String(resultJSON) };
        }
        default:
          return { id, ok: false, error: { code: "INVALID_REQUEST", message: "INVALID_REQUEST: unknown command" } };
      }
    } catch (err) {
      return { id, ok: false, error: { code: "UNAVAILABLE", message: String(err) } };
    }
  };

  createStatusWindow();
  broadcastStatus({ state: "connecting", message: "connecting to gateway bridge" });

  const start = async () => {
    await bridge.connect({
      host,
      port,
      hello: {
        nodeId,
        displayName: buildDisplayName(),
        token,
        platform: "linux",
        version: nowVersion(),
        deviceFamily: "desktop",
        modelIdentifier: os.arch(),
        caps: ["canvas", "camera", "screen", "system"],
        commands: [
          "system.run",
          "system.notify",
          "screen.record",
          "camera.list",
          "camera.snap",
          "canvas.present",
          "canvas.hide",
          "canvas.navigate",
          "canvas.eval",
          "canvas.snapshot",
          "canvas.a2ui.reset",
          "canvas.a2ui.push",
          "canvas.a2ui.pushJSONL",
        ],
      },
      silentPairing: false,
      onStatus: (m) => broadcastStatus({ message: m }),
      onPairOk: async (tok) => {
        await saveAuth({ nodeId, token: tok });
        broadcastStatus({ message: "paired; token saved" });
      },
      onHelloOk: (info) => {
        broadcastStatus({ state: "connected", message: `connected to ${info.serverName}` });
      },
      onInvoke: async (req) => {
        const res = await onInvoke(req);
        return { ...res, id: req.id };
      },
    });
  };

  void start().catch((err) => {
    broadcastStatus({ state: "failed", message: String(err) });
  });
}

app.on("window-all-closed", () => {
  // Keep running as a node even if the status window is closed.
});

app.whenReady().then(() => {
  void main();
});
