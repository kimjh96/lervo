import { DatabaseSync, type DatabaseSyncOptions } from "node:sqlite";

/** Lock wait for ordinary stores; a writer elsewhere holds a lock for at most a few seconds. */
export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export interface SqliteConnectionOptions extends DatabaseSyncOptions {
  /**
   * How long any statement waits for another connection's lock. Zero makes a lock attempt fail
   * at once, for callers that treat a held lock as an answer.
   */
  busyTimeoutMs: number;
}

/**
 * Opens a connection whose first statement installs the busy handler. A journal-mode or schema
 * statement that ran before it would fail at once while another process held the database, for
 * example during its recovery or migration, instead of waiting for the lock.
 */
export function openSqliteDatabase(path: string, options: SqliteConnectionOptions): DatabaseSync {
  const { busyTimeoutMs, ...databaseOptions } = options;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60_000)
    throw new RangeError("busyTimeoutMs must be a safe integer from 0 to 60,000.");
  const database = new DatabaseSync(path, databaseOptions);
  try {
    database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}

/**
 * Whether a statement failed only because another connection held a lock it needed:
 * `SQLITE_BUSY` (5) or `SQLITE_LOCKED` (6), including their extended codes.
 */
export function isSqliteLockContention(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 0xff);
}
