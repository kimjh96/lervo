import { spawn } from "node:child_process";

import { GitCommandError } from "./repository-replica-failure.js";

const MAXIMUM_GIT_OUTPUT_BYTES = 512 * 1024 * 1024;

export interface GitResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

/**
 * Runs one bounded Git process for replica work. An exit code outside `allowedExitCodes` rejects
 * with a `GitCommandError` that keeps the exit code and stderr for structured failure reporting.
 */
export async function git(
  repositoryRoot: string,
  args: readonly string[],
  options: {
    input?: Uint8Array | string;
    environment?: NodeJS.ProcessEnv;
    allowedExitCodes?: number[];
  } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repositoryRoot, ...args], {
      env: { ...process.env, ...options.environment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let byteCount = 0;
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      byteCount += chunk.byteLength;
      if (byteCount > MAXIMUM_GIT_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        reject(new Error("Git output exceeded the repository replica bound."));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", reject);
    child.once("close", (exitCode) => {
      const code = exitCode ?? 1;
      const result = {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exitCode: code,
      };
      if (!(options.allowedExitCodes ?? [0]).includes(code)) {
        reject(new GitCommandError(args[0] ?? "command", code, result.stderr.toString("utf8")));
        return;
      }
      resolve(result);
    });
    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input);
  });
}

export function text(result: GitResult): string {
  return result.stdout.toString("utf8").trim();
}
