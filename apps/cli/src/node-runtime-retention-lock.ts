import { assertRealRuntimeRoot } from "./node-runtime-root-guard.js";
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { openSqliteDatabase } from "@lervo/sqlite-connection";

/** One host guard serializes lock recovery; the PID lock spans asynchronous runtime effects. */
export async function withNodeRuntimeRetentionLock<T>(
  path: string,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await assertRealRuntimeRoot(dirname(path));
  const guardPath = `${path}.sqlite`;
  const guardInfo = await lstat(guardPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (guardInfo && (!guardInfo.isFile() || guardInfo.isSymbolicLink()))
    throw new Error("Unsafe runtime lock guard.");
  const guard = openSqliteDatabase(guardPath, { busyTimeoutMs: 0 });
  try {
    guard.exec("BEGIN IMMEDIATE");
    try {
      const previous = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let pid;
      let empty = false;
      try {
        const info = fstatSync(previous);
        if (!info.isFile() || info.size > 64) throw new Error("Unsafe runtime lock.");
        empty = info.size === 0;
        pid = Number(readFileSync(previous, "utf8"));
      } finally {
        closeSync(previous);
      }
      if (!Number.isSafeInteger(pid) || (pid < 1 && !empty))
        throw new Error("Invalid runtime lock owner.");
      let dead = empty;
      try {
        if (!empty) process.kill(pid, 0);
      } catch (error) {
        dead = (error as NodeJS.ErrnoException).code === "ESRCH";
      }
      if (!dead) throw new Error("Another runtime operation is active.");
      rmSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, String(process.pid));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    guard.exec("COMMIT");
  } finally {
    guard.close();
  }
  try {
    return await work();
  } finally {
    rmSync(path, { force: true });
  }
}
