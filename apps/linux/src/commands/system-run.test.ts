import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { systemRun } from "./system-run.js";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";

vi.mock("node:child_process");

function createMockProcess(options: {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  error?: Error;
}) {
  const proc = new EventEmitter() as ReturnType<typeof childProcess.spawn>;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  (proc as unknown as { stdout: EventEmitter }).stdout = stdoutEmitter;
  (proc as unknown as { stderr: EventEmitter }).stderr = stderrEmitter;
  (proc as unknown as { kill: () => void }).kill = vi.fn();

  setTimeout(() => {
    if (options.stdout) stdoutEmitter.emit("data", Buffer.from(options.stdout));
    if (options.stderr) stderrEmitter.emit("data", Buffer.from(options.stderr));
    if (options.error) {
      proc.emit("error", options.error);
    } else {
      proc.emit("close", options.exitCode ?? 0);
    }
  }, 5);

  return proc;
}

describe("systemRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns error for empty command", async () => {
    const result = await systemRun({ command: [] });
    expect(result.success).toBe(false);
    expect(result.error).toContain("command required");
  });

  it("executes command and returns stdout", async () => {
    vi.mocked(childProcess.spawn).mockReturnValue(
      createMockProcess({ stdout: "hello world\n", exitCode: 0 })
    );

    const result = await systemRun({ command: ["echo", "hello world"] });

    expect(childProcess.spawn).toHaveBeenCalledWith("echo", ["hello world"], expect.any(Object));
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world\n");
    expect(result.timedOut).toBe(false);
  });

  it("captures stderr on failure", async () => {
    vi.mocked(childProcess.spawn).mockReturnValue(
      createMockProcess({ stderr: "file not found", exitCode: 1 })
    );

    const result = await systemRun({ command: ["ls", "/nonexistent"] });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("file not found");
  });

  it("handles spawn error", async () => {
    vi.mocked(childProcess.spawn).mockReturnValue(
      createMockProcess({ error: new Error("spawn ENOENT") })
    );

    const result = await systemRun({ command: ["nonexistent-binary"] });

    expect(result.success).toBe(false);
    expect(result.error).toContain("spawn ENOENT");
  });

  it("passes cwd and env options", async () => {
    vi.mocked(childProcess.spawn).mockReturnValue(
      createMockProcess({ stdout: "ok", exitCode: 0 })
    );

    await systemRun({
      command: ["pwd"],
      cwd: "/tmp",
      env: { FOO: "bar" },
    });

    expect(childProcess.spawn).toHaveBeenCalledWith(
      "pwd",
      [],
      expect.objectContaining({
        cwd: "/tmp",
        env: expect.objectContaining({ FOO: "bar" }),
      })
    );
  });

  it("handles timeout", async () => {
    // Create a process that doesn't emit close on its own - will be killed by timeout
    const proc = new EventEmitter() as ReturnType<typeof childProcess.spawn>;
    const stdoutEmitter = new EventEmitter();
    const stderrEmitter = new EventEmitter();
    (proc as unknown as { stdout: EventEmitter }).stdout = stdoutEmitter;
    (proc as unknown as { stderr: EventEmitter }).stderr = stderrEmitter;

    let killed = false;
    (proc as unknown as { kill: (signal?: string) => void }).kill = vi.fn((signal) => {
      killed = true;
      // Simulate process being killed after SIGKILL
      setTimeout(() => proc.emit("close", null), 5);
    });

    vi.mocked(childProcess.spawn).mockReturnValue(proc);

    const result = await systemRun({ command: ["sleep", "100"], timeoutMs: 50 });

    expect(killed).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(result.success).toBe(false);
  });

  it("handles string command", async () => {
    vi.mocked(childProcess.spawn).mockReturnValue(
      createMockProcess({ stdout: "", exitCode: 0 })
    );

    await systemRun({ command: "echo" });

    expect(childProcess.spawn).toHaveBeenCalledWith("echo", [], expect.any(Object));
  });
});
