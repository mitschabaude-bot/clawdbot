import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export type ScreenRecordParams = {
  screenIndex?: number;
  durationMs?: number;
  fps?: number;
  format?: string;
  includeAudio?: boolean;
};

export type ScreenRecordPayload = {
  format: string;
  base64: string;
  durationMs?: number;
  fps?: number;
  screenIndex?: number;
  hasAudio: boolean;
};

async function execFileAsync(cmd: string, args: string[]) {
  return await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = (err as { code?: number } | null)?.code;
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        code: typeof code === "number" ? code : err ? 1 : 0,
      });
    });
  });
}

async function detectScreenSize(): Promise<{ width: number; height: number } | null> {
  const res = await execFileAsync("xrandr", ["--current"]);
  if (res.code !== 0) return null;
  const match = res.stdout.match(/current\s+(\d+)\s+x\s+(\d+)/i);
  if (!match) return null;
  const width = Number.parseInt(match[1] ?? "", 10);
  const height = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

export async function screenRecord(params: ScreenRecordParams): Promise<ScreenRecordPayload> {
  const format = typeof params.format === "string" ? params.format.trim().toLowerCase() : "mp4";
  if (format && format !== "mp4") {
    throw new Error("INVALID_REQUEST: screen format must be mp4");
  }

  const fps =
    typeof params.fps === "number" && Number.isFinite(params.fps) && params.fps > 0
      ? params.fps
      : 20;

  const durationMs =
    typeof params.durationMs === "number" && Number.isFinite(params.durationMs) && params.durationMs > 0
      ? Math.floor(params.durationMs)
      : 5_000;

  const display = process.env.DISPLAY && process.env.DISPLAY.trim() ? process.env.DISPLAY.trim() : ":0";

  const size = (await detectScreenSize()) ?? { width: 1280, height: 720 };

  const outPath = path.join(os.tmpdir(), `clawdbot-screen-${randomUUID()}.mp4`);

  // X11 grab. Audio capture is intentionally disabled in MVP (Ubuntu desktop audio routing varies).
  // We still surface includeAudio/hasAudio fields for protocol compatibility.
  const args = [
    "-y",
    "-f",
    "x11grab",
    "-video_size",
    `${size.width}x${size.height}`,
    "-framerate",
    String(fps),
    "-i",
    `${display}.0+0,0`,
    "-t",
    String(Math.max(0.1, durationMs / 1000)),
    "-pix_fmt",
    "yuv420p",
    outPath,
  ];

  const res = await execFileAsync("ffmpeg", args);
  if (res.code !== 0) {
    throw new Error(`SCREEN_RECORD_FAILED: ${res.stderr || res.stdout || "ffmpeg failed"}`);
  }

  const data = await fs.readFile(outPath);
  await fs.rm(outPath, { force: true });

  return {
    format: "mp4",
    base64: data.toString("base64"),
    durationMs,
    fps,
    screenIndex: params.screenIndex,
    hasAudio: false,
  };
}
