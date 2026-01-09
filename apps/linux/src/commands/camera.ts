import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export type CameraListPayload = {
  devices: Array<{ id: string; name: string; position?: string }>;
};

export type CameraSnapParams = {
  deviceId?: string;
  facing?: "front" | "back";
  maxWidth?: number;
  quality?: number;
  delayMs?: number;
};

export type CameraSnapPayload = {
  format: string;
  base64: string;
  width: number;
  height: number;
};

async function execFileAsync(cmd: string, args: string[]) {
  return await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    execFile(cmd, args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = (err as { code?: number } | null)?.code;
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        code: typeof code === "number" ? code : err ? 1 : 0,
      });
    });
  });
}

async function listVideoDevicesFromDev(): Promise<string[]> {
  try {
    const entries = await fs.readdir("/dev");
    return entries
      .filter((e) => e.startsWith("video"))
      .map((e) => path.join("/dev", e))
      .sort();
  } catch {
    return [];
  }
}

export async function cameraList(): Promise<CameraListPayload> {
  // Best effort: enumerate /dev/video* and (optionally) enrich via v4l2-ctl.
  const devs = await listVideoDevicesFromDev();

  const base = devs.map((id) => ({ id, name: id, position: "unspecified" }));

  const v4l = await execFileAsync("v4l2-ctl", ["--list-devices"]);
  if (v4l.code !== 0 || !v4l.stdout.trim()) {
    return { devices: base };
  }

  // Parse blocks like:
  // Camera Name (usb-0000:...):
  // 	/dev/video0
  // 	/dev/video1
  const devices: Array<{ id: string; name: string; position?: string }> = [];
  let currentName: string | null = null;
  for (const rawLine of v4l.stdout.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (!line.startsWith("/dev/")) {
      currentName = line.replace(/:\s*$/, "").trim();
      continue;
    }
    if (line.startsWith("/dev/")) {
      const id = line.trim();
      const name = currentName && currentName.length > 0 ? currentName : id;
      devices.push({ id, name, position: "unspecified" });
    }
  }

  return { devices: devices.length > 0 ? devices : base };
}

async function probeImageSize(filePath: string): Promise<{ width: number; height: number } | null> {
  const res = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    filePath,
  ]);
  if (res.code !== 0) return null;
  try {
    const parsed = JSON.parse(res.stdout) as unknown;
    const streams =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as { streams?: unknown }).streams
        : undefined;
    if (!Array.isArray(streams) || streams.length === 0) return null;
    const s = streams[0] as Record<string, unknown>;
    const width = typeof s.width === "number" ? s.width : 0;
    const height = typeof s.height === "number" ? s.height : 0;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  } catch {
    return null;
  }
}

export async function cameraSnap(params: CameraSnapParams): Promise<CameraSnapPayload> {
  const deviceId =
    typeof params.deviceId === "string" && params.deviceId.trim()
      ? params.deviceId.trim()
      : (await listVideoDevicesFromDev())[0];

  if (!deviceId) throw new Error("CAMERA_UNAVAILABLE: no /dev/video* devices");

  const delayMs =
    typeof params.delayMs === "number" && Number.isFinite(params.delayMs) && params.delayMs > 0
      ? Math.floor(params.delayMs)
      : 200;

  const quality =
    typeof params.quality === "number" && Number.isFinite(params.quality)
      ? Math.min(1, Math.max(0.05, params.quality))
      : 0.9;

  const maxWidth =
    typeof params.maxWidth === "number" && Number.isFinite(params.maxWidth) && params.maxWidth > 0
      ? Math.floor(params.maxWidth)
      : undefined;

  if (delayMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  const outPath = path.join(os.tmpdir(), `clawdbot-camera-snap-${randomUUID()}.jpg`);

  const vf = maxWidth ? `scale='min(iw,${maxWidth})':-2` : undefined;

  const args = [
    "-y",
    "-f",
    "v4l2",
    "-i",
    deviceId,
    ...(vf ? ["-vf", vf] : []),
    "-frames:v",
    "1",
    "-q:v",
    String(Math.round((1 - quality) * 30 + 2)),
    outPath,
  ];

  const res = await execFileAsync("ffmpeg", args);
  if (res.code !== 0) {
    throw new Error(`CAMERA_SNAP_FAILED: ${res.stderr || res.stdout || "ffmpeg failed"}`);
  }

  const buf = await fs.readFile(outPath);
  const size = (await probeImageSize(outPath)) ?? { width: 0, height: 0 };
  await fs.rm(outPath, { force: true });

  if (size.width <= 0 || size.height <= 0) {
    // Keep protocol shape stable; consumers expect width/height.
    throw new Error("CAMERA_SNAP_FAILED: could not determine image dimensions");
  }

  return {
    format: "jpg",
    base64: buf.toString("base64"),
    width: size.width,
    height: size.height,
  };
}
