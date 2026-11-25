// Runs Git for a workspace's base and its replayed commits. Git never asks for anything: a
// credential or host-key prompt fails at once instead of holding a terminal, and a timeout ends
// Git with every helper it started (Lervo ADE sessions, "The workspace's base").
import { spawn } from "node:child_process";

const MAXIMUM_OUTPUT_BYTES = 16 * 1024 * 1024;

/** A Git failure, with Git's exit code, or null when it was stopped or could not start. */
export class GitRunError extends Error {
  constructor(
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(`git exited with ${code ?? "no code"}: ${stderr.trim().slice(0, 400)}`);
    this.name = "GitRunError";
  }
}

export interface RunGitOptions {
  /** Ends Git and its helpers after this many milliseconds. */
  readonly timeout?: number;
  /** Returns the output as Git wrote it, for `-z` lists whose names may start or end in spaces. */
  readonly raw?: boolean;
  /** Extra environment, such as the committer identity. */
  readonly env?: NodeJS.ProcessEnv;
  /** Variables Git must not inherit, such as `GIT_DIR`, which would override the folder. */
  readonly unset?: readonly string[];
}

/** The environment that keeps Git, its credential helpers, and ssh from waiting for a person. */
export function nonInteractiveGitEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_SSH_COMMAND: base.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
  };
}

/**
 * Runs `git -C root ...arguments_` without ever waiting for a person, and returns its trimmed
 * output. Git runs in its own process group, so a timeout ends ssh and remote helpers too.
 */
export function runGit(
  root: string,
  arguments_: readonly string[],
  options: RunGitOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const environment = nonInteractiveGitEnvironment({ ...process.env, ...options.env });
    for (const name of options.unset ?? []) delete environment[name];
    // A process group exists only on POSIX; Windows gets no console window either way.
    const grouped = process.platform !== "win32";
    const child = spawn("git", ["-C", root, ...arguments_], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      detached: grouped,
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let stopped = false;
    const stop = () => {
      stopped = true;
      try {
        if (grouped && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = options.timeout === undefined ? null : setTimeout(stop, options.timeout);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAXIMUM_OUTPUT_BYTES) stop();
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", () => {
      if (timer !== null) clearTimeout(timer);
      reject(new GitRunError(null, "git could not start"));
    });
    child.on("close", (code) => {
      if (timer !== null) clearTimeout(timer);
      const error = Buffer.concat(stderr).toString("utf8");
      if (stopped || code === null) reject(new GitRunError(null, error || "git was stopped"));
      else if (code !== 0) reject(new GitRunError(code, error));
      else {
        const output = Buffer.concat(stdout).toString("utf8");
        resolve(options.raw === true ? output : output.trim());
      }
    });
  });
}
