import { constants } from "node:fs";
import { lstat, open, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { ProjectStorageError } from "./types.js";

const INITIALIZATION_LOCK_BYTES = 1_024;
const STALE_INITIALIZATION_LOCK_AGE_MS = 5_000;
const INITIALIZATION_LOCK_ATTEMPTS = 1_500;

interface InitializationLock {
  schemaVersion: 1;
  processId: number;
  createdAt: string;
}

function invalid(message: string, cause?: unknown): never {
  throw new ProjectStorageError(
    "coordination_home_invalid",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function staleInitializationLock(path: string, now: Date): Promise<boolean> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > INITIALIZATION_LOCK_BYTES ||
    (process.platform !== "win32" && (info.mode & 0o077) !== 0)
  ) {
    invalid("The repository coordination initialization lock is unsafe.");
  }
  if (now.getTime() - info.mtimeMs < STALE_INITIALIZATION_LOCK_AGE_MS) return false;
  if (info.size < 1) invalid("The repository coordination initialization lock is invalid.");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    invalid("The repository coordination initialization lock is unreadable.", error);
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3
  ) {
    invalid("The repository coordination initialization lock is invalid.");
  }
  const lock = value as InitializationLock;
  const createdAt = Date.parse(lock.createdAt);
  if (
    lock.schemaVersion !== 1 ||
    !Number.isSafeInteger(lock.processId) ||
    lock.processId < 1 ||
    !Number.isFinite(createdAt)
  ) {
    invalid("The repository coordination initialization lock is invalid.");
  }
  return (
    now.getTime() - createdAt >= STALE_INITIALIZATION_LOCK_AGE_MS && !processIsAlive(lock.processId)
  );
}

export async function acquireInitializationLock(root: string): Promise<() => Promise<void>> {
  const path = resolve(root, ".initializing.lock");
  // A busy repository may hold the lock for several seconds while preparing
  // coordination state. Keep retries bounded, but outwait that normal overlap.
  for (let attempt = 0; attempt < INITIALIZATION_LOCK_ATTEMPTS; attempt += 1) {
    try {
      const handle = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      await handle.writeFile(
        `${JSON.stringify({ schemaVersion: 1, processId: process.pid, createdAt: new Date().toISOString() })}\n`,
      );
      await handle.sync();
      return async () => {
        await handle.close();
        await rm(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await staleInitializationLock(path, new Date())) {
        await rm(path, { force: true });
        continue;
      }
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 10));
    }
  }
  throw new ProjectStorageError(
    "coordination_busy",
    "Repository coordination initialization did not become available.",
  );
}
