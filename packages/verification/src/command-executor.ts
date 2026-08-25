import { spawn, type ChildProcess } from "node:child_process";

import type { VerificationCommand } from "@lervo/schemas";

export interface RawCommandResult {
  status:
    "passed" | "failed" | "timed_out" | "output_limit_exceeded" | "execution_error" | "cancelled";
  exitCode: number | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

function commandEnvironment(
  command: VerificationCommand,
  source: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path"]) {
    if (source[name] !== undefined) result[name] = source[name];
  }
  for (const name of command.environmentVariableNames) {
    if (source[name] !== undefined) result[name] = source[name];
  }
  return result;
}

function killProcessTree(child: ChildProcess): void {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The process may already have exited; the direct kill remains a safe fallback.
    }
  }
  child.kill("SIGKILL");
}

export async function executeVerificationCommand(input: {
  command: VerificationCommand;
  cwd: string;
  signal?: AbortSignal;
  now: () => Date;
  environment: Readonly<Record<string, string | undefined>>;
}): Promise<RawCommandResult> {
  const startedAt = input.now();
  const monotonicStart = performance.now();
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(input.command.executable, input.command.arguments, {
        cwd: input.cwd,
        detached: process.platform !== "win32",
        env: commandEnvironment(input.command, input.environment),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve({
        status: "execution_error",
        exitCode: null,
        startedAt: startedAt.toISOString(),
        completedAt: input.now().toISOString(),
        durationMs: Math.max(0, Math.round(performance.now() - monotonicStart)),
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let forced: RawCommandResult["status"] | null = null;
    let spawnError = false;
    let settled = false;

    const capture = (target: Buffer[], chunk: Buffer): void => {
      if (forced === "output_limit_exceeded") return;
      const remaining = input.command.maxOutputBytes - outputBytes;
      if (chunk.byteLength > remaining) {
        if (remaining > 0) target.push(chunk.subarray(0, remaining));
        outputBytes = input.command.maxOutputBytes;
        forced = "output_limit_exceeded";
        killProcessTree(child);
        return;
      }
      target.push(chunk);
      outputBytes += chunk.byteLength;
    };
    child.stdout!.on("data", (chunk: Buffer) => capture(stdout, chunk));
    child.stderr!.on("data", (chunk: Buffer) => capture(stderr, chunk));
    child.on("error", () => {
      spawnError = true;
    });

    const timeout = setTimeout(() => {
      if (forced === null) {
        forced = "timed_out";
        killProcessTree(child);
      }
    }, input.command.timeoutMs);
    const abort = (): void => {
      if (forced === null) {
        forced = "cancelled";
        killProcessTree(child);
      }
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) abort();

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      const status = forced ?? (spawnError ? "execution_error" : code === 0 ? "passed" : "failed");
      resolve({
        status,
        exitCode: code,
        startedAt: startedAt.toISOString(),
        completedAt: input.now().toISOString(),
        durationMs: Math.max(0, Math.round(performance.now() - monotonicStart)),
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}
