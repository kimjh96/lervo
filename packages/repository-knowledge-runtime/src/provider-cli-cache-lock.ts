import { ensurePrivateDirectory } from "./private-state-file.js";
import { chmod, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

// Entries exist only while a host-cache operation is active; observers never enter this queue.
const pending = new Map<string, Promise<unknown>>();
export async function withProviderCliCacheLock<T>(
  directory: string,
  run: () => Promise<T>,
): Promise<T> {
  const key = resolve(directory);
  const prior = pending.get(key);
  const operation = (async () => {
    await prior?.catch(() => undefined);
    await ensurePrivateDirectory(key);
    const path = resolve(key, "cache-lock.sqlite");
    try {
      const file = await lstat(path);
      if (!file.isFile() || file.isSymbolicLink())
        throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const db = openSqliteDatabase(path, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS });
    await chmod(path, 0o600);
    const nonce = randomUUID();
    let acquired = false;
    try {
      db.exec(
        "CREATE TABLE IF NOT EXISTS holder (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, nonce TEXT NOT NULL)",
      );
      db.exec("BEGIN IMMEDIATE");
      try {
        const owner = db.prepare("SELECT pid FROM holder WHERE id=1").get() as
          { pid: number } | undefined;
        let alive = owner !== undefined;
        if (owner !== undefined) {
          try {
            process.kill(owner.pid, 0);
          } catch (error) {
            alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
          }
        }
        if (alive) throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
        db.prepare("INSERT OR REPLACE INTO holder(id,pid,nonce) VALUES(1,?,?)").run(
          process.pid,
          nonce,
        );
        db.exec("COMMIT");
        acquired = true;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return await run();
    } finally {
      if (acquired) db.prepare("DELETE FROM holder WHERE id=1 AND nonce=?").run(nonce);
      db.close();
    }
  })();
  pending.set(key, operation);
  try {
    return await operation;
  } finally {
    if (pending.get(key) === operation) pending.delete(key);
  }
}
