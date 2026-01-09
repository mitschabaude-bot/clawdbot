import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadAuth, saveAuth, authPath, setBaseDirOverride } from "./store.js";

describe("store", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdbot-store-test-"));
    setBaseDirOverride(tempDir);
  });

  afterEach(async () => {
    setBaseDirOverride(null);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("loadAuth returns null when file does not exist", async () => {
    const result = await loadAuth();
    expect(result).toBeNull();
  });

  it("saveAuth creates directory and file", async () => {
    await saveAuth({ nodeId: "test-node-id", token: "test-token" });

    const filePath = authPath();
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);

    expect(parsed.nodeId).toBe("test-node-id");
    expect(parsed.token).toBe("test-token");
  });

  it("loadAuth reads saved auth", async () => {
    await saveAuth({ nodeId: "saved-node", token: "saved-token" });
    const loaded = await loadAuth();

    expect(loaded).not.toBeNull();
    expect(loaded?.nodeId).toBe("saved-node");
    expect(loaded?.token).toBe("saved-token");
  });

  it("loadAuth handles missing token", async () => {
    await saveAuth({ nodeId: "no-token-node" });
    const loaded = await loadAuth();

    expect(loaded?.nodeId).toBe("no-token-node");
    expect(loaded?.token).toBeUndefined();
  });

  it("loadAuth returns null for invalid JSON", async () => {
    const filePath = authPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "not valid json", "utf8");

    const result = await loadAuth();
    expect(result).toBeNull();
  });

  it("loadAuth returns null for empty nodeId", async () => {
    const filePath = authPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ nodeId: "", token: "t" }), "utf8");

    const result = await loadAuth();
    expect(result).toBeNull();
  });
});
