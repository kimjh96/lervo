import { spawn, type ChildProcess } from "node:child_process";
import { providerCliDispatchContext } from "./provider-dispatch-context.js";

export interface ProcessResult {
  status:
    "completed" | "failed" | "timed_out" | "cancelled" | "output_limit_exceeded" | "spawn_failed";
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function killProcessTree(child: ChildProcess): void {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The process may already be gone; direct kill is a safe fallback.
    }
  }
  child.kill("SIGKILL");
}

export async function runProcess(input: {
  executable: string;
  environment?: NodeJS.ProcessEnv;
  arguments: readonly string[];
  cwd: string;
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputBytes?: number;
}): Promise<ProcessResult> {
  const maxOutputBytes = input.maxOutputBytes ?? 4 * 1024 * 1024;
  return new Promise((finish) => {
    let child: ChildProcess;
    try {
      child = spawn(input.executable, [...input.arguments], {
        cwd: input.cwd,
        detached: process.platform !== "win32",
        env: providerCliDispatchContext(input.environment).environment,
        shell: false,
        stdio: [input.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      finish({ status: "spawn_failed", exitCode: null, stdout: "", stderr: "" });
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let forced: ProcessResult["status"] | null = null;
    let spawnFailed = false;
    // A process that closed its input before reading it in full acted on part of it.
    let inputCutShort = false;
    let settled = false;
    const capture = (target: Buffer[], chunk: Buffer): void => {
      if (forced === "output_limit_exceeded") return;
      const remaining = maxOutputBytes - outputBytes;
      if (chunk.byteLength > remaining) {
        if (remaining > 0) target.push(chunk.subarray(0, remaining));
        outputBytes = maxOutputBytes;
        forced = "output_limit_exceeded";
        killProcessTree(child);
        return;
      }
      target.push(chunk);
      outputBytes += chunk.byteLength;
    };
    child.stdout?.on("data", (chunk: Buffer) => capture(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => capture(stderr, chunk));
    child.once("error", () => {
      spawnFailed = true;
    });
    const timeout = setTimeout(() => {
      if (forced === null) {
        forced = "timed_out";
        killProcessTree(child);
      }
    }, input.timeoutMs);
    const abort = (): void => {
      if (forced === null) {
        forced = "cancelled";
        killProcessTree(child);
      }
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) abort();
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      const status =
        forced ??
        (spawnFailed ? "spawn_failed" : code === 0 && !inputCutShort ? "completed" : "failed");
      finish({
        status,
        exitCode: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin?.on("error", () => {
      inputCutShort = true;
    });
    if (input.stdin !== undefined) child.stdin?.end(input.stdin);
  });
}
