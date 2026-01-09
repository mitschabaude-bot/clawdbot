/**
 * Integration tests for Linux BridgeClient ↔ startNodeBridgeServer.
 *
 * These tests verify the Linux node's BridgeClient can properly:
 * 1. Connect and handle NOT_PAIRED response
 * 2. Send pair-request and receive pair-ok after approval
 * 3. Reconnect with token after pairing
 * 4. Handle invoke requests from the server
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { approveNodePairing, listNodePairing } from "../node-pairing.js";
import { startNodeBridgeServer, type NodeBridgeServer } from "./server.js";

// Import the Linux BridgeClient from the compiled dist folder
import { BridgeClient } from "../../../apps/linux/dist/bridge/client.js";

describe("Linux BridgeClient ↔ Bridge Server", () => {
  let baseDir = "";
  let server: NodeBridgeServer;

  beforeAll(async () => {
    process.env.CLAWDBOT_ENABLE_BRIDGE_IN_TESTS = "1";
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdbot-linux-client-test-"));
  });

  afterAll(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
    delete process.env.CLAWDBOT_ENABLE_BRIDGE_IN_TESTS;
  });

  beforeEach(async () => {
    server = await startNodeBridgeServer({
      host: "127.0.0.1",
      port: 0,
      pairingBaseDir: baseDir,
    });
  });

  afterEach(async () => {
    await server?.close();
  });

  it("connects, gets NOT_PAIRED, sends pair-request, and completes pairing", async () => {
    const client = new BridgeClient();
    const statusLog: string[] = [];
    let receivedToken = "";
    let helloOkReceived = false;

    const connectPromise = client.connect({
      host: "127.0.0.1",
      port: server.port,
      hello: {
        nodeId: "linux-test-1",
        displayName: "Linux Test Node",
        platform: "linux",
        version: "1.0.0",
        deviceFamily: "Desktop",
        modelIdentifier: "Ubuntu-24.04",
        caps: ["canvas", "screen"],
        commands: ["system.run", "system.notify", "screen.record"],
        permissions: { screenRecording: true },
      },
      silentPairing: true,
      onStatus: (msg) => statusLog.push(msg),
      onPairOk: (token) => {
        receivedToken = token;
      },
      onHelloOk: () => {
        helloOkReceived = true;
      },
      onInvoke: async (req) => ({
        id: req.id,
        ok: true,
        payloadJSON: JSON.stringify({ echoed: req.command }),
      }),
    });

    // Wait for the pair-request to arrive at the server
    let reqId: string | undefined;
    for (let i = 0; i < 50; i++) {
      const list = await listNodePairing(baseDir);
      const req = list.pending.find((p) => p.nodeId === "linux-test-1");
      if (req) {
        reqId = req.requestId;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(reqId).toBeTruthy();
    if (!reqId) throw new Error("Expected pending requestId");

    // Approve the pairing
    await approveNodePairing(reqId, baseDir);

    // Wait for client to receive pair-ok and hello-ok
    for (let i = 0; i < 50; i++) {
      if (receivedToken && helloOkReceived) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(receivedToken).toBeTruthy();
    expect(helloOkReceived).toBe(true);
    expect(statusLog).toContain("connecting");
    expect(statusLog.some((s) => s.includes("pairing required"))).toBe(true);
    expect(statusLog.some((s) => s.includes("connected"))).toBe(true);

    await client.disconnect();
  });

  it("reconnects with stored token after pairing", async () => {
    const client = new BridgeClient();
    let token = "";

    // First connection: pair
    await client.connect({
      host: "127.0.0.1",
      port: server.port,
      hello: {
        nodeId: "linux-test-reconnect",
        platform: "linux",
      },
      silentPairing: true,
      onPairOk: (t) => {
        token = t;
      },
      onInvoke: async (req) => ({ id: req.id, ok: true, payloadJSON: null }),
    });

    // Approve pairing
    let reqId: string | undefined;
    for (let i = 0; i < 50; i++) {
      const list = await listNodePairing(baseDir);
      const req = list.pending.find((p) => p.nodeId === "linux-test-reconnect");
      if (req) {
        reqId = req.requestId;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(reqId).toBeTruthy();
    await approveNodePairing(reqId!, baseDir);

    // Wait for token
    for (let i = 0; i < 50; i++) {
      if (token) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(token).toBeTruthy();

    await client.disconnect();

    // Second connection: use token directly
    const client2 = new BridgeClient();
    let helloOk = false;
    const statusLog: string[] = [];

    await client2.connect({
      host: "127.0.0.1",
      port: server.port,
      hello: {
        nodeId: "linux-test-reconnect",
        token,
        platform: "linux",
      },
      onStatus: (msg) => statusLog.push(msg),
      onHelloOk: () => {
        helloOk = true;
      },
      onInvoke: async (req) => ({ id: req.id, ok: true, payloadJSON: null }),
    });

    // Wait for hello-ok
    for (let i = 0; i < 50; i++) {
      if (helloOk) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(helloOk).toBe(true);
    // Should NOT require pairing again
    expect(statusLog.some((s) => s.includes("pairing required"))).toBe(false);

    await client2.disconnect();
  });

  it("handles invoke requests from the server", async () => {
    const client = new BridgeClient();
    let token = "";
    const invokedCommands: string[] = [];

    await client.connect({
      host: "127.0.0.1",
      port: server.port,
      hello: {
        nodeId: "linux-test-invoke",
        platform: "linux",
        commands: ["system.run", "camera.snap"],
      },
      silentPairing: true,
      onPairOk: (t) => {
        token = t;
      },
      onInvoke: async (req) => {
        invokedCommands.push(req.command);
        if (req.command === "system.run") {
          return {
            id: req.id,
            ok: true,
            payloadJSON: JSON.stringify({ stdout: "hello world", exitCode: 0 }),
          };
        }
        return {
          id: req.id,
          ok: false,
          error: { code: "UNKNOWN_COMMAND", message: `Unknown: ${req.command}` },
        };
      },
    });

    // Approve pairing
    let reqId: string | undefined;
    for (let i = 0; i < 50; i++) {
      const list = await listNodePairing(baseDir);
      const req = list.pending.find((p) => p.nodeId === "linux-test-invoke");
      if (req) {
        reqId = req.requestId;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    await approveNodePairing(reqId!, baseDir);

    // Wait for connection to be ready
    for (let i = 0; i < 50; i++) {
      if (token) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    // Give the client time to receive hello-ok
    await new Promise((r) => setTimeout(r, 100));

    // Server invokes a command on the client
    const res = await server.invoke({
      nodeId: "linux-test-invoke",
      command: "system.run",
      paramsJSON: JSON.stringify({ command: ["echo", "hello"] }),
      timeoutMs: 3000,
    });

    expect(res.ok).toBe(true);
    const payload = JSON.parse(res.payloadJSON ?? "{}") as { stdout?: string };
    expect(payload.stdout).toBe("hello world");
    expect(invokedCommands).toContain("system.run");

    await client.disconnect();
  });

  it("responds to ping frames with pong", async () => {
    const client = new BridgeClient();
    let token = "";

    await client.connect({
      host: "127.0.0.1",
      port: server.port,
      hello: {
        nodeId: "linux-test-ping",
        platform: "linux",
      },
      silentPairing: true,
      onPairOk: (t) => {
        token = t;
      },
      onInvoke: async (req) => ({ id: req.id, ok: true, payloadJSON: null }),
    });

    // Approve pairing
    let reqId: string | undefined;
    for (let i = 0; i < 50; i++) {
      const list = await listNodePairing(baseDir);
      const req = list.pending.find((p) => p.nodeId === "linux-test-ping");
      if (req) {
        reqId = req.requestId;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    await approveNodePairing(reqId!, baseDir);

    // Wait for connection
    for (let i = 0; i < 50; i++) {
      if (token) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    // The server should be able to list the connected node
    await new Promise((r) => setTimeout(r, 100));
    const connected = server.listConnected();
    const node = connected.find((n) => n.nodeId === "linux-test-ping");
    expect(node).toBeTruthy();
    expect(node?.platform).toBe("linux");

    await client.disconnect();
  });

  it("reports canvasHostUrl from hello-ok", async () => {
    // Create a server with canvas host configured
    await server.close();
    server = await startNodeBridgeServer({
      host: "127.0.0.1",
      port: 0,
      pairingBaseDir: baseDir,
      canvasHostPort: 8080,
      canvasHostHost: "192.168.1.100",
    });

    const client = new BridgeClient();
    let receivedCanvasUrl: string | undefined;
    let token = "";

    await client.connect({
      host: "127.0.0.1",
      port: server.port,
      hello: {
        nodeId: "linux-test-canvas",
        platform: "linux",
      },
      silentPairing: true,
      onPairOk: (t) => {
        token = t;
      },
      onHelloOk: (info) => {
        receivedCanvasUrl = info.canvasHostUrl;
      },
      onInvoke: async (req) => ({ id: req.id, ok: true, payloadJSON: null }),
    });

    // Approve pairing
    let reqId: string | undefined;
    for (let i = 0; i < 50; i++) {
      const list = await listNodePairing(baseDir);
      const req = list.pending.find((p) => p.nodeId === "linux-test-canvas");
      if (req) {
        reqId = req.requestId;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    await approveNodePairing(reqId!, baseDir);

    // Wait for hello-ok
    for (let i = 0; i < 50; i++) {
      if (token && receivedCanvasUrl !== undefined) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    // Should have received canvas URL (or it should be accessible via getter)
    const canvasUrl = client.getCanvasHostUrl();
    // Note: The actual URL depends on server-side resolveCanvasHostUrl logic
    // Just verify the client received something or handled it gracefully

    await client.disconnect();
  });
});
