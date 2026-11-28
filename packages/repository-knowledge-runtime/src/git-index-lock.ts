import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** An empty index lock younger than this may still belong to a Git command that just started. */
export const STALE_GIT_INDEX_LOCK_AGE_MS = 10 * 60_000;

/**
 * An index lock no Git command holds: empty, older than the bound, while no `git` process runs.
 * Git leaves one behind when a command is killed, and every later commit then fails. It belongs to
 * the owner's repository, so Lervo reports it and never deletes it.
 */
export interface StaleGitIndexLock {
  /** Relative to the repository root when inside it, as `.git/index.lock`; otherwise absolute. */
  path: string;
  /** Whole seconds since the lock was last modified. */
  ageSeconds: number;
  modifiedAt: string;
}

/** Whether any `git` process runs on this host, or null when the process list is unreadable. */
export async function gitProcessRunning(): Promise<boolean | null> {
  try {
    const { stdout } = await execute("ps", ["-A", "-o", "comm="], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.split("\n").some((line) => {
      const command = basename(line.trim());
      return command === "git" || command.startsWith("git-");
    });
  } catch {
    return null;
  }
}

/**
 * The stale index lock of this checkout, or null when there is none or staleness is unproven: a
 * missing, non-empty, or recent lock, a running `git` process, or a process list Lervo cannot read
 * all leave the lock to the ordinary busy check.
 */
export async function staleGitIndexLock(
  repositoryRoot: string,
  options: { now?: number; gitRunning?: () => Promise<boolean | null> } = {},
): Promise<StaleGitIndexLock | null> {
  let absolute: string;
  try {
    const { stdout } = await execute(
      "git",
      ["-C", repositoryRoot, "rev-parse", "--git-path", "index.lock"],
      { encoding: "utf8" },
    );
    absolute = resolve(repositoryRoot, stdout.trim());
  } catch {
    return null;
  }
  const stat = await lstat(absolute).catch(() => null);
  if (stat === null || !stat.isFile() || stat.size !== 0) return null;
  const age = (options.now ?? Date.now()) - stat.mtimeMs;
  if (!(age >= STALE_GIT_INDEX_LOCK_AGE_MS)) return null;
  if ((await (options.gitRunning ?? gitProcessRunning)()) !== false) return null;
  const inside = relative(repositoryRoot, absolute);
  return {
    path: inside.startsWith("..") || isAbsolute(inside) ? absolute : inside,
    ageSeconds: Math.floor(age / 1000),
    modifiedAt: stat.mtime.toISOString(),
  };
}

/** The exact owner step for a stale lock; Lervo itself never runs it. */
export function staleGitIndexLockInstruction(lock: StaleGitIndexLock): string {
  const minutes = Math.floor(lock.ageSeconds / 60);
  return `Git index lock ${lock.path} is empty, ${minutes} minutes old (since ${lock.modifiedAt}), and no git process is running, so every Git commit in this repository fails. Lervo never deletes it. Remove it yourself with rm ${lock.path} from the repository root once no Git command of yours is still running.`;
}
