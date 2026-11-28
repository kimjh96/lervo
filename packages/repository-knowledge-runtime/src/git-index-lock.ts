import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { shellWord } from "@lervo/repository-registry";

import { hostGitLockObservation, type GitLockObservation } from "./git-lock-observation.js";

const execute = promisify(execFile);

/** An empty index lock younger than this may still belong to a Git command that just started. */
export const STALE_GIT_INDEX_LOCK_AGE_MS = 10 * 60_000;

/**
 * An index lock no Git command visibly holds: empty, older than the bound, on local storage, while
 * no Git process is visible on this host, Windows included under WSL. Git leaves one behind when a
 * command is killed, and every later commit then fails. It belongs to the owner's repository, so
 * Lervo reports it and never deletes it.
 */
export interface StaleGitIndexLock {
  /** Relative to the repository root when inside it, as `.git/index.lock`; otherwise absolute. */
  path: string;
  /** Whole seconds since the lock was last modified. */
  ageSeconds: number;
  modifiedAt: string;
}

/**
 * The stale index lock of this checkout, or null when there is none or staleness is unproven: a
 * missing, non-empty, recent, or future-dated lock, a visible Git process, shared storage, or any
 * check that cannot answer all leave the lock to the ordinary busy check.
 */
export async function staleGitIndexLock(
  repositoryRoot: string,
  options: { now?: number; observation?: GitLockObservation } = {},
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
  // A future time, as from clock skew on shared storage, proves no age at all.
  const age = (options.now ?? Date.now()) - stat.mtimeMs;
  if (!(age >= STALE_GIT_INDEX_LOCK_AGE_MS)) return null;
  const observation = options.observation ?? hostGitLockObservation;
  const [local, visible] = await Promise.all([
    observation.localStorage(dirname(absolute)),
    observation.gitProcessVisible(),
  ]);
  if (local !== true || visible !== false) return null;
  const inside = relative(repositoryRoot, absolute);
  return {
    path: inside.startsWith("..") || isAbsolute(inside) ? absolute : inside,
    ageSeconds: Math.floor(age / 1000),
    modifiedAt: stat.mtime.toISOString(),
  };
}

/**
 * The exact owner step for a stale lock; Lervo itself never runs it. `withAge: false` leaves the
 * changing age out, for text that feeds a stable identifier such as an upgrade plan ID.
 */
export function staleGitIndexLockInstruction(
  lock: StaleGitIndexLock,
  options: { withAge?: boolean } = {},
): string {
  const age =
    options.withAge === false
      ? `last modified ${lock.modifiedAt}`
      : `${Math.floor(lock.ageSeconds / 60)} minutes old (since ${lock.modifiedAt})`;
  return `Git index lock ${lock.path} is empty, ${age}, and no Git process is visible on this host, so every Git commit in this repository fails. Lervo never deletes it. First close any IDE, container, or other host that may be using this repository, then remove it from the repository root with rm ${shellWord(lock.path)}.`;
}
