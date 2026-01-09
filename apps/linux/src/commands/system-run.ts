import { spawn } from "node:child_process";

export type SystemRunParams = {
  command: string[] | string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  needsScreenRecording?: boolean;
};

export type SystemRunPayload = {
  exitCode: number | null;
  timedOut: boolean;
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
};

export async function systemRun(params: SystemRunParams): Promise<SystemRunPayload> {
  const argv = Array.isArray(params.command)
    ? params.command.map((c) => String(c))
    : [String(params.command)];

  if (argv.length === 0 || !argv[0]) {
    return {
      exitCode: null,
      timedOut: false,
      success: false,
      stdout: "",
      stderr: "",
      error: "INVALID_REQUEST: command required",
    };
  }

  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(0, params.timeoutMs)
      : undefined;

  return await new Promise<SystemRunPayload>((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: typeof params.cwd === "string" && params.cwd.trim() ? params.cwd : undefined,
      env: params.env ? { ...process.env, ...params.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer =
      timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            try {
              child.kill("SIGKILL");
            } catch {
              // ignore
            }
          }, timeoutMs)
        : null;

    child.stdout?.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString("utf8");
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: null,
        timedOut,
        success: false,
        stdout,
        stderr,
        error: String(err),
      });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: typeof code === "number" ? code : null,
        timedOut,
        success: !timedOut && code === 0,
        stdout,
        stderr,
      });
    });
  });
}
