import { type DatabaseSync } from "node:sqlite";

import { EventStoreError } from "./errors.js";

const migrations = [
  `
    CREATE TABLE IF NOT EXISTS store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      seq INTEGER NOT NULL CHECK (seq >= 1),
      run_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      policy_version TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      previous_hash TEXT,
      event_hash TEXT NOT NULL,
      UNIQUE (project_id, seq),
      UNIQUE (project_id, event_hash)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS events_run_seq ON events (project_id, run_id, seq);
    CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
      BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
      BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
  `,
] as const;

export const storageSchemaVersion = migrations.length;

export function configureDatabase(database: DatabaseSync): void {
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

export function migrateDatabase(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const row = database.prepare("PRAGMA user_version;").get();
    const version = row?.user_version;
    if (typeof version !== "number" || !Number.isSafeInteger(version)) {
      throw new EventStoreError("integrity_failed", "SQLite schema version을 읽을 수 없습니다.");
    }
    if (version > storageSchemaVersion) {
      throw new EventStoreError(
        "integrity_failed",
        `지원하지 않는 event store schema입니다: ${version}`,
      );
    }
    for (let index = version; index < migrations.length; index += 1) {
      database.exec(migrations[index] as string);
      database.exec(`PRAGMA user_version = ${index + 1};`);
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
