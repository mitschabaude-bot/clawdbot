import net from "node:net";
import { randomUUID } from "node:crypto";

import type {
  AnyBridgeFrame,
  BridgeErrorFrame,
  BridgeHelloFrame,
  BridgeHelloOkFrame,
  BridgeInvokeRequestFrame,
  BridgeInvokeResponseFrame,
  BridgePairOkFrame,
  BridgePairRequestFrame,
  BridgePingFrame,
  BridgePongFrame,
} from "./protocol.js";

export type BridgeClientOpts = {
  host: string;
  port: number;
  hello: Omit<BridgeHelloFrame, "type">;
  silentPairing?: boolean;
  onStatus?: (message: string) => void;
  onHelloOk?: (info: { serverName: string; canvasHostUrl?: string }) => void;
  onPairOk?: (token: string) => void;
  onInvoke: (
    req: Omit<BridgeInvokeRequestFrame, "type">,
  ) => Promise<Omit<BridgeInvokeResponseFrame, "type">>;
};

function encodeLine(frame: AnyBridgeFrame) {
  return `${JSON.stringify(frame)}\n`;
}

function parseLine(line: string): AnyBridgeFrame {
  return JSON.parse(line) as AnyBridgeFrame;
}

export class BridgeClient {
  private socket: net.Socket | null = null;
  private buffer = "";
  private canvasHostUrl: string | undefined;

  async connect(opts: BridgeClientOpts): Promise<void> {
    await this.disconnect();

    opts.onStatus?.("connecting");

    const socket = net.createConnection({ host: opts.host, port: opts.port });
    this.socket = socket;
    socket.setNoDelay(true);

    const send = (frame: AnyBridgeFrame) => {
      socket.write(encodeLine(frame));
    };

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.off("error", onError);
        resolve();
      });
    });

    let currentToken = opts.hello.token;

    const sendHello = () => {
      send({ type: "hello", ...opts.hello, token: currentToken } satisfies BridgeHelloFrame);
    };

    const sendPairRequest = () => {
      send({
        type: "pair-request",
        nodeId: opts.hello.nodeId,
        displayName: opts.hello.displayName,
        platform: opts.hello.platform,
        version: opts.hello.version,
        deviceFamily: opts.hello.deviceFamily,
        modelIdentifier: opts.hello.modelIdentifier,
        caps: opts.hello.caps,
        commands: opts.hello.commands,
        permissions: opts.hello.permissions,
        silent: opts.silentPairing === true ? true : undefined,
      } satisfies BridgePairRequestFrame);
    };

    const handleFrame = async (frame: AnyBridgeFrame) => {
      const type = typeof frame.type === "string" ? frame.type : "";
      switch (type) {
        case "hello-ok": {
          const ok = frame as BridgeHelloOkFrame;
          this.canvasHostUrl =
            typeof ok.canvasHostUrl === "string" && ok.canvasHostUrl.trim()
              ? ok.canvasHostUrl.trim()
              : undefined;
          opts.onHelloOk?.({
            serverName: String(ok.serverName ?? ""),
            canvasHostUrl: this.canvasHostUrl,
          });
          opts.onStatus?.(`connected: ${ok.serverName}`);
          return;
        }
        case "pair-ok": {
          const ok = frame as BridgePairOkFrame;
          const token = String(ok.token ?? "").trim();
          if (token) {
            opts.onPairOk?.(token);
            // Re-send hello with the new token to complete handshake
            currentToken = token;
            sendHello();
          }
          return;
        }
        case "error": {
          const err = frame as BridgeErrorFrame;
          const code = String(err.code ?? "");
          const message = String(err.message ?? "");
          if (code === "NOT_PAIRED" || code === "UNAUTHORIZED") {
            opts.onStatus?.("pairing required; requesting approval");
            sendPairRequest();
            return;
          }
          throw new Error(`${code || "ERROR"}: ${message}`);
        }
        case "ping": {
          const ping = frame as BridgePingFrame;
          send({ type: "pong", id: String(ping.id ?? "") } satisfies BridgePongFrame);
          return;
        }
        case "invoke": {
          const req = frame as BridgeInvokeRequestFrame;
          const res = await opts.onInvoke({
            id: String(req.id ?? randomUUID()),
            command: String(req.command ?? ""),
            paramsJSON: req.paramsJSON ?? null,
          });
          send({ type: "invoke-res", ...res } satisfies BridgeInvokeResponseFrame);
          return;
        }
        default:
          return;
      }
    };

    socket.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      while (true) {
        const idx = this.buffer.indexOf("\n");
        if (idx === -1) break;
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        void (async () => {
          try {
            const frame = parseLine(trimmed);
            await handleFrame(frame);
          } catch (err) {
            opts.onStatus?.(`protocol error: ${String(err)}`);
            try {
              socket.destroy();
            } catch {
              // ignore
            }
          }
        })();
      }
    });

    socket.on("close", () => {
      opts.onStatus?.("disconnected");
    });

    sendHello();
  }

  getCanvasHostUrl() {
    return this.canvasHostUrl;
  }

  async disconnect() {
    if (!this.socket) return;
    const sock = this.socket;
    this.socket = null;
    this.buffer = "";
    await new Promise<void>((resolve) => {
      sock.once("close", () => resolve());
      try {
        sock.destroy();
      } catch {
        resolve();
      }
    });
  }
}
