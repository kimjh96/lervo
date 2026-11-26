import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, readFile, rename, rm } from "node:fs/promises";
import { hostname } from "node:os";

import { fail } from "./git-command.js";

/** A lock younger than this is live whatever its process, as the workforce lock's gate is. */
export const MARKER_LOCK_STALE_MS = 60_000;
/** An empty or unreadable lock is a writer's partial file until it is this old. */
export const MARKER_LOCK_GRACE_MS = 5_000;
const MAXIMUM_LOCK_BYTES = 4_096;

interface MarkerLockContent {
  schemaVersion: 1;
  token: string;
  pid: number;
  hostname: string;
  createdAt: string;
}

/** The lock's bytes and modification time, or null when no lock is there. */
async function readLock(path: string): Promise<{ text: string; modifiedAt: number } | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAXIMUM_LOCK_BYTES)
      return { text: "", modifiedAt: Number.POSITIVE_INFINITY };
    return { text: await readFile(path, "utf8"), modifiedAt: info.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function parseLock(text: string): MarkerLockContent | null {
  try {
    const value = JSON.parse(text) as Partial<MarkerLockContent> | null;
    return value !== null &&
      value.schemaVersion === 1 &&
      typeof value.token === "string" &&
      typeof value.hostname === "string" &&
      Number.isSafeInteger(value.pid) &&
      Number.isFinite(Date.parse(value.createdAt ?? ""))
      ? (value as MarkerLockContent)
      : null;
  } catch {
    return null;
  }
}

function processLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Whether a lock's holder is gone. Another host's lock is never stale, since its process cannot be
 * observed; a lock younger than the gate is live; an older one is stale once its process is gone.
 * An empty or unreadable lock is stale only past a short grace, since this module never writes
 * one, but an older writer might have been interrupted.
 */
function lockStale(lock: { text: string; modifiedAt: number }, now: number): boolean {
  const content = parseLock(lock.text);
  if (content === null) return now - lock.modifiedAt > MARKER_LOCK_GRACE_MS;
  if (content.hostname !== hostname()) return false;
  if (now - Date.parse(content.createdAt) < MARKER_LOCK_STALE_MS) return false;
  return !processLive(content.pid);
}

/** Writes `content` whole to a new private file, so whoever links or renames it never sees less. */
async function writeWhole(path: string, content: string): Promise<void> {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function linked(source: string, target: string): Promise<boolean> {
  try {
    await link(source, target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function busy(): never {
  fail("host_operation_in_progress", "Another process is replacing the workspace marker.");
}

/**
 * Replaces a stale lock with this holder's, under a short takeover lock that only one taker holds:
 * the lock must still be the exact bytes judged stale, the replacement is one rename, and the
 * holder reads the lock back before it acts. A takeover lock older than the grace is a crashed
 * taker's and is removed, so the next attempt can take over.
 */
async function takeOver(
  path: string,
  judged: string,
  own: { temporary: string; token: string; content: string },
  now: number,
): Promise<void> {
  const takeover = `${path}.takeover`;
  const takeoverTemporary = `${takeover}.${own.token}.tmp`;
  await writeWhole(takeoverTemporary, own.content);
  try {
    if (!(await linked(takeoverTemporary, takeover))) {
      const other = await readLock(takeover);
      if (other !== null && now - other.modifiedAt > MARKER_LOCK_GRACE_MS)
        await rm(takeover, { force: true });
      busy();
    }
  } finally {
    await rm(takeoverTemporary, { force: true });
  }
  try {
    if ((await readLock(path))?.text !== judged) busy();
    await rename(own.temporary, path);
    if (parseLock((await readLock(path))?.text ?? "")?.token !== own.token) busy();
  } finally {
    await rm(takeover, { force: true });
  }
}

/**
 * Takes the marker's replacement lock: a file that names this holder's token, process, host, and
 * creation time, written whole before it appears. A live holder refuses with
 * `host_operation_in_progress`; a stale one is taken over once. The release removes the lock only
 * while it still holds this holder's token, so it never removes another holder's lock.
 */
export async function acquireMarkerLock(
  path: string,
  now: () => number = Date.now,
): Promise<() => Promise<void>> {
  const token = randomUUID();
  const content = `${JSON.stringify({
    schemaVersion: 1,
    token,
    pid: process.pid,
    hostname: hostname(),
    createdAt: new Date(now()).toISOString(),
  } satisfies MarkerLockContent)}\n`;
  const temporary = `${path}.${token}.tmp`;
  await writeWhole(temporary, content);
  try {
    if (!(await linked(temporary, path))) {
      const current = await readLock(path);
      if (current === null) {
        if (!(await linked(temporary, path))) busy();
      } else if (lockStale(current, now())) {
        await takeOver(path, current.text, { temporary, token, content }, now());
      } else busy();
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return async () => {
    const held = await readLock(path);
    if (held !== null && parseLock(held.text)?.token === token) await rm(path, { force: true });
  };
}
