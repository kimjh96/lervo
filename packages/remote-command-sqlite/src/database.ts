import { lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type DatabaseSync } from "node:sqlite";

import { RemoteCommandSQLiteError } from "./errors.js";

export async function ensureRemoteCommandDatabasePath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  try {
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new RemoteCommandSQLiteError(
        "integrity_failed",
        "The remote command SQLite path must be a regular file.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolutePath;
}

export function configureRemoteCommandDatabase(database: DatabaseSync): void {
  const defensiveDatabase = database as DatabaseSync & {
    enableDefensive?: (active: boolean) => void;
  };
  defensiveDatabase.enableDefensive?.(true);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
}

export function migrateRemoteCommandDatabase(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const version = database.prepare("PRAGMA user_version;").get()?.user_version;
    if (version !== 0 && version !== 1) {
      throw new RemoteCommandSQLiteError(
        "integrity_failed",
        "The remote command SQLite schema is unsupported.",
      );
    }
    if (version === 0) {
      database.exec(`
        CREATE TABLE remote_command_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT;
        CREATE TABLE remote_command_replay (
          idempotency_key TEXT PRIMARY KEY,
          command_hash TEXT NOT NULL,
          nonce TEXT NOT NULL UNIQUE,
          reservation_id TEXT NOT NULL UNIQUE,
          receipt_json TEXT
        ) STRICT;
        CREATE TRIGGER remote_command_replay_no_delete
          BEFORE DELETE ON remote_command_replay
          BEGIN SELECT RAISE(ABORT, 'remote command replay records cannot be deleted'); END;
        CREATE TRIGGER remote_command_replay_coordinate_immutable
          BEFORE UPDATE ON remote_command_replay
          WHEN OLD.idempotency_key != NEW.idempotency_key
            OR OLD.command_hash != NEW.command_hash
            OR OLD.nonce != NEW.nonce
            OR OLD.reservation_id != NEW.reservation_id
            OR OLD.receipt_json IS NOT NULL
          BEGIN SELECT RAISE(ABORT, 'remote command replay coordinates are immutable'); END;
        PRAGMA user_version = 1;
      `);
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
