import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CommandFailure } from "./command-error-output.js";

/**
 * ADR-0571 host lock, shared by the host upgrade and the ADR-0575 follower: one live holder per
 * lock file. `busy` builds the failure for a live holder, or for a lock taken first by another run
 * (null pid).
 */
export interface HostProcessLock {
  path: string;
  busy: (holder: number | null) => CommandFailure;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const readLockHolder = async (path: string): Promise<number | null> => {
  const holder = Number.parseInt(await readFile(path, "utf8").catch(() => ""), 10);
  return Number.isSafeInteger(holder) && holder > 0 ? holder : null;
};

/**
 * The lock appears with its holder's pid already inside: the pid is written to a private file
 * that is then hard-linked into place, which fails if a lock exists. A dead holder's lock is
 * renamed away to a unique name before it is judged, so two runs never both take it over.
 */
async function acquireHostProcessLock(lock: HostProcessLock): Promise<string> {
  await mkdir(dirname(lock.path), { recursive: true, mode: 0o700 });
  const token = `${process.pid}\n${randomUUID()}\n`;
  const candidate = `${lock.path}.${randomUUID()}`;
  await writeFile(candidate, token, { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await link(candidate, lock.path);
        return token;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const holder = await readLockHolder(lock.path);
      if (holder !== null && processIsAlive(holder)) throw lock.busy(holder);
      const stale = `${lock.path}.stale-${randomUUID()}`;
      await rename(lock.path, stale).catch(() => undefined);
      const movedHolder = await readLockHolder(stale);
      if (movedHolder !== null && processIsAlive(movedHolder)) {
        // A live run took the lock between the read and the rename; give it back.
        await link(stale, lock.path).catch(() => undefined);
      }
      await rm(stale, { force: true });
    }
  } finally {
    await rm(candidate, { force: true });
  }
  throw lock.busy(null);
}

/** Runs `operation` while holding the lock; it is removed only while it still holds this token. */
export async function withHostProcessLock<T>(
  lock: HostProcessLock,
  operation: () => Promise<T>,
): Promise<T> {
  const token = await acquireHostProcessLock(lock);
  try {
    return await operation();
  } finally {
    if ((await readFile(lock.path, "utf8").catch(() => "")) === token)
      await rm(lock.path, { force: true });
  }
}
