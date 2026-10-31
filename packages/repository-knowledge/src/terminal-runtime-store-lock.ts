import { constants } from "node:fs";
import { chmod, open } from "node:fs/promises";
import { resolve } from "node:path";
import { openSqliteDatabase } from "@lervo/sqlite-connection";

/** A kernel-held SQLite writer lock covers publication and retention, including process death. */
export async function acquireTerminalRuntimeStoreLock(
  store: string,
): Promise<(() => Promise<void>) | null> {
  const path = resolve(store, ".materialize-lock.sqlite");
  const file = await open(
    path,
    constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  await file.close();
  await chmod(path, 0o600);
  const database = openSqliteDatabase(path, { busyTimeoutMs: 0 });
  try {
    database.exec("BEGIN IMMEDIATE;");
  } catch (error) {
    database.close();
    const code = (error as { errcode?: number }).errcode;
    if (code === 5 || code === 6) return null;
    throw error;
  }
  return async () => {
    database.close();
  };
}
