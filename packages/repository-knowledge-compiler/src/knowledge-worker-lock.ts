import { randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  fsyncSync,
  chmodSync,
} from "node:fs";
import { mkdir, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function lockBytes(path: string): { bytes: string; modifiedAt: number } | null {
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 1024) throw new Error("Unsafe knowledge worker lock.");
      return { bytes: readFileSync(fd, "utf8"), modifiedAt: stat.mtimeMs };
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function serialized<T>(path: string, run: () => T): T {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("Unsafe knowledge worker guard.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const db = openSqliteDatabase(path, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS });
  chmodSync(path, 0o600);
  try {
    db.exec("BEGIN IMMEDIATE");
    const value = run();
    db.exec("COMMIT");
    return value;
  } finally {
    db.close();
  }
}

/** Serialize stale reclamation, respect legacy PID locks, and release only the exact acquired token. */
export async function acquireKnowledgeWorkerLock(
  root: string,
): Promise<(() => Promise<void>) | null> {
  let directory = root;
  for (const part of [".lervo", "state"]) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Unsafe knowledge worker state directory.");
  }
  const path = resolve(directory, "knowledge-worker.lock");
  const guard = resolve(directory, "knowledge-worker-lock.sqlite");
  const token = `${process.pid}\n${randomUUID()}\n`;
  const acquired = serialized(guard, () => {
    const current = lockBytes(path);
    if (current) {
      const owner = Number(current.bytes.split("\n")[0]);
      if (!Number.isSafeInteger(owner) || owner < 1) {
        if (Date.now() - current.modifiedAt < 5000) return false;
        throw new Error("The knowledge worker lock owner is invalid.");
      }
      if (alive(owner)) return false;
      rmSync(path);
    }
    let fd: number;
    try {
      fd = openSync(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      writeFileSync(fd, token);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return true;
  });
  if (!acquired) return null;
  let released = false;
  return async () => {
    if (released) return;
    serialized(guard, () => {
      if (lockBytes(path)?.bytes === token) rmSync(path);
    });
    released = true;
  };
}
