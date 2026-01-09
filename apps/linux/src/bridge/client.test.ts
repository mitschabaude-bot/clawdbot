import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as net from "node:net";
import { BridgeClient } from "./client.js";
import type { AnyBridgeFrame } from "./protocol.js";

function createMockServer() {
  const server = net.createServer();
  const connections: net.Socket[] = [];
  const receivedFrames: AnyBridgeFrame[] = [];

  server.on("connection", (socket) => {
    connections.push(socket);
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx === -1) break;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim()) {
          receivedFrames.push(JSON.parse(line.trim()) as AnyBridgeFrame);
        }
      }
    });
  });

  const send = (frame: AnyBridgeFrame) => {
    const data = JSON.stringify(frame) + "\n";
    for (const conn of connections) {
      conn.write(data);
    }
  };

  const start = (port: number) =>
    new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    });

  const stop = () =>
    new Promise<void>((resolve) => {
      for (const conn of connections) conn.destroy();
      server.close(() => resolve());
    });

  return { server, send, receivedFrames, start, stop, connections };
}

describe("BridgeClient", () => {
  let mockServer: ReturnType<typeof createMockServer>;
  const TEST_PORT = 17339;

  beforeEach(async () => {
    mockServer = createMockServer();
    await mockServer.start(TEST_PORT);
  });

  afterEach(async () => {
    await mockServer.stop();
  });

  it("sends hello frame on connect", async () => {
    const client = new BridgeClient();
    const statusMessages: string[] = [];

    const connectPromise = client.connect({
      host: "127.0.0.1",
      port: TEST_PORT,
      hello: {
        nodeId: "test-node-123",
        displayName: "Test Node",
        platform: "linux",
        version: "1.0.0",
        deviceFamily: "desktop",
        modelIdentifier: "x64",
        caps: ["system"],
        commands: ["system.run"],
      },
      onStatus: (m) => statusMessages.push(m),
      onInvoke: async (req) => ({ id: req.id, ok: true }),
    });

    // Wait for hello to arrive
    await new Promise((r) => setTimeout(r, 50));

    expect(mockServer.receivedFrames.length).toBeGreaterThan(0);
    const hello = mockServer.receivedFrames[0];
    expect(hello?.type).toBe("hello");
    expect((hello as { nodeId?: string }).nodeId).toBe("test-node-123");

    await client.disconnect();
  });

  it("handles hello-ok response", async () => {
    const client = new BridgeClient();
    let helloOkReceived = false;
    let serverName = "";

    const connectPromise = client.connect({
      host: "127.0.0.1",
      port: TEST_PORT,
      hello: {
        nodeId: "test-node-456",
        token: "existing-token",
      },
      onHelloOk: (info) => {
        helloOkReceived = true;
        serverName = info.serverName;
      },
      onInvoke: async (req) => ({ id: req.id, ok: true }),
    });

    await new Promise((r) => setTimeout(r, 30));
    mockServer.send({ type: "hello-ok", serverName: "TestGateway" });
    await new Promise((r) => setTimeout(r, 30));

    expect(helloOkReceived).toBe(true);
    expect(serverName).toBe("TestGateway");

    await client.disconnect();
  });

  it("requests pairing when NOT_PAIRED error received", async () => {
    const client = new BridgeClient();
    const statusMessages: string[] = [];

    client.connect({
      host: "127.0.0.1",
      port: TEST_PORT,
      hello: { nodeId: "unpaired-node" },
      onStatus: (m) => statusMessages.push(m),
      onInvoke: async (req) => ({ id: req.id, ok: true }),
    });

    await new Promise((r) => setTimeout(r, 30));
    mockServer.send({ type: "error", code: "NOT_PAIRED", message: "Node not paired" });
    await new Promise((r) => setTimeout(r, 50));

    const pairRequest = mockServer.receivedFrames.find((f) => f.type === "pair-request");
    expect(pairRequest).toBeDefined();
    expect((pairRequest as { nodeId?: string }).nodeId).toBe("unpaired-node");

    await client.disconnect();
  });

  it("handles pair-ok and saves token", async () => {
    const client = new BridgeClient();
    let receivedToken = "";

    client.connect({
      host: "127.0.0.1",
      port: TEST_PORT,
      hello: { nodeId: "pairing-node" },
      onPairOk: (token) => {
        receivedToken = token;
      },
      onInvoke: async (req) => ({ id: req.id, ok: true }),
    });

    await new Promise((r) => setTimeout(r, 30));
    mockServer.send({ type: "pair-ok", token: "new-secret-token-xyz" });
    await new Promise((r) => setTimeout(r, 30));

    expect(receivedToken).toBe("new-secret-token-xyz");

    await client.disconnect();
  });

  it("responds to ping with pong", async () => {
    const client = new BridgeClient();

    client.connect({
      host: "127.0.0.1",
      port: TEST_PORT,
      hello: { nodeId: "ping-test-node" },
      onInvoke: async (req) => ({ id: req.id, ok: true }),
    });

    await new Promise((r) => setTimeout(r, 30));
    mockServer.receivedFrames.length = 0; // Clear hello frame

    mockServer.send({ type: "ping", id: "ping-123" });
    await new Promise((r) => setTimeout(r, 30));

    const pong = mockServer.receivedFrames.find((f) => f.type === "pong");
    expect(pong).toBeDefined();
    expect((pong as { id?: string }).id).toBe("ping-123");

    await client.disconnect();
  });

  it("handles invoke request and sends response", async () => {
    const client = new BridgeClient();
    let invokedCommand = "";

    client.connect({
      host: "127.0.0.1",
      port: TEST_PORT,
      hello: { nodeId: "invoke-test-node" },
      onInvoke: async (req) => {
        invokedCommand = req.command;
        return {
          id: req.id,
          ok: true,
          payloadJSON: JSON.stringify({ result: "success" }),
        };
      },
    });

    await new Promise((r) => setTimeout(r, 30));
    mockServer.receivedFrames.length = 0;

    mockServer.send({
      type: "invoke",
      id: "invoke-456",
      command: "system.run",
      paramsJSON: JSON.stringify({ command: ["echo", "test"] }),
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(invokedCommand).toBe("system.run");

    const response = mockServer.receivedFrames.find((f) => f.type === "invoke-res");
    expect(response).toBeDefined();
    expect((response as { id?: string }).id).toBe("invoke-456");
    expect((response as { ok?: boolean }).ok).toBe(true);

    await client.disconnect();
  });

  it("stores canvasHostUrl from hello-ok", async () => {
    const client = new BridgeClient();

    client.connect({
      host: "127.0.0.1",
      port: TEST_PORT,
      hello: { nodeId: "canvas-test-node" },
      onInvoke: async (req) => ({ id: req.id, ok: true }),
    });

    await new Promise((r) => setTimeout(r, 30));
    mockServer.send({
      type: "hello-ok",
      serverName: "TestGateway",
      canvasHostUrl: "http://localhost:8080/",
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(client.getCanvasHostUrl()).toBe("http://localhost:8080/");

    await client.disconnect();
  });
});
