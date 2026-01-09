import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export type BridgeStoredAuth = {
  nodeId: string;
  token?: string;
};

function baseDir() {
  return path.join(os.homedir(), ".clawdbot", "linux-node");
}

export function authPath() {
  return path.join(baseDir(), "bridge.json");
}

export async function loadAuth(): Promise<BridgeStoredAuth | null> {
  try {
    const raw = await fs.readFile(authPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const nodeId = typeof obj.nodeId === "string" ? obj.nodeId.trim() : "";
    if (!nodeId) return null;
    const token = typeof obj.token === "string" ? obj.token.trim() : undefined;
    return { nodeId, token: token || undefined };
  } catch {
    return null;
  }
}

export async function saveAuth(auth: BridgeStoredAuth) {
  const dir = path.dirname(authPath());
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${authPath()}.tmp-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(auth, null, 2), "utf8");
  await fs.rename(tmp, authPath());
}
