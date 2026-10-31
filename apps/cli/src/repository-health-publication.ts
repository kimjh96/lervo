import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chmodSync, renameSync } from "node:fs";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";
import type { DatabaseSync } from "node:sqlite";
import type { RepositoryHealthProjectionV1 } from "@lervo/application-contract";
import { MAXIMUM_HEALTH_FILE_BYTES, REPOSITORY_HEALTH_PATH } from "./repository-health-reader.js";

async function stateDirectory(root: string): Promise<string> {
  let directory = resolve(root);
  for (const part of [".lervo", "state"]) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new Error("Unsafe health state directory.");
  }
  return directory;
}

async function generationTransaction<T>(root: string, run: (db: DatabaseSync) => T): Promise<T> {
  const path = resolve(await stateDirectory(root), "repository-health-generation.sqlite");
  const stats = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (stats && (!stats.isFile() || stats.isSymbolicLink()))
    throw new Error("Unsafe health generation file.");
  const db = openSqliteDatabase(path, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS });
  chmodSync(path, 0o600);
  try {
    db.exec(
      "BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS generation (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL)",
    );
    const result = run(db);
    db.exec("COMMIT");
    return result;
  } finally {
    db.close();
  }
}

/** Claim before reading any sources. A newer computation fences every older publisher. */
export async function beginRepositoryHealthProjection(root: string): Promise<number> {
  return generationTransaction(root, (db) => {
    db.exec("INSERT INTO generation VALUES(1,1) ON CONFLICT(id) DO UPDATE SET value=value+1");
    return Number(
      (db.prepare("SELECT value FROM generation WHERE id=1").get() as { value: number }).value,
    );
  });
}

/** Atomic replace under the generation transaction, shared by all processes on this checkout. */
export async function publishRepositoryHealth(
  root: string,
  value: RepositoryHealthProjectionV1,
  generation?: number,
): Promise<void> {
  const claimed = generation ?? (await beginRepositoryHealthProjection(root));
  const bytes = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(bytes) > MAXIMUM_HEALTH_FILE_BYTES)
    throw new Error("Repository health projection exceeds its bound.");
  const directory = await stateDirectory(root);
  const temporary = resolve(directory, `.repository-health-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await generationTransaction(root, (db) => {
      if (
        Number(
          (
            db.prepare("SELECT value FROM generation WHERE id=1").get() as
              { value: number } | undefined
          )?.value,
        ) === claimed
      )
        renameSync(temporary, resolve(root, REPOSITORY_HEALTH_PATH));
    });
  } finally {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}
