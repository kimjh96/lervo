import { type DatabaseSync } from "node:sqlite";

import { EventStoreError } from "./errors.js";
import { reportStorageSchemaVersion } from "./report-schema.js";
import { sqliteRow } from "./sqlite-row.js";

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
  `
    CREATE TABLE outbox (
      event_id TEXT NOT NULL REFERENCES events(event_id),
      destination_id TEXT NOT NULL,
      enqueued_at TEXT NOT NULL,
      available_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      lease_owner TEXT,
      lease_started_at TEXT,
      lease_expires_at TEXT,
      acknowledged_at TEXT,
      last_failure_code TEXT,
      last_failed_at TEXT,
      PRIMARY KEY (event_id, destination_id),
      CHECK ((lease_owner IS NULL) = (lease_started_at IS NULL)),
      CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
      CHECK (acknowledged_at IS NULL OR lease_owner IS NULL),
      CHECK ((last_failure_code IS NULL) = (last_failed_at IS NULL))
    ) STRICT;
    CREATE INDEX outbox_ready
      ON outbox (acknowledged_at, available_at, lease_expires_at, enqueued_at, event_id);
  `,
  `
    CREATE UNIQUE INDEX events_one_work_causality_per_run
      ON events (project_id, run_id)
      WHERE type = 'work.causality.recorded';
    CREATE UNIQUE INDEX events_one_root_per_work
      ON events (project_id, json_extract(payload_json, '$.workId'))
      WHERE type = 'work.causality.recorded'
        AND json_extract(payload_json, '$.relationship') = 'root';
  `,
] as const;

export const storageSchemaVersion = migrations.length;

/**
 * Read-path indexes outside the versioned schema. They add no rows, constraints, or meaning, so
 * creating them never changes `user_version`, and readers that predate them, including exact-version
 * read-only readers, keep opening the store. A missing index only makes type-filtered reads slower.
 */
const supplementalIndexes = `
  CREATE INDEX IF NOT EXISTS events_type_seq ON events (project_id, type, seq);
`;

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

export function migrateDatabase(
  database: DatabaseSync,
  transaction: "independent" | "nested" = "independent",
): void {
  database.exec(transaction === "nested" ? "SAVEPOINT migrate_schema;" : "BEGIN IMMEDIATE;");
  try {
    const row = sqliteRow(database.prepare("PRAGMA user_version;").get());
    const version = row?.user_version;
    if (typeof version !== "number" || !Number.isSafeInteger(version)) {
      throw new EventStoreError("integrity_failed", "The SQLite schema version cannot be read.");
    }
    if (version > reportStorageSchemaVersion) {
      throw new EventStoreError("integrity_failed", `Unsupported event store schema: ${version}`);
    }
    for (let index = version; index < migrations.length; index += 1) {
      database.exec(migrations[index] as string);
      database.exec(`PRAGMA user_version = ${index + 1};`);
    }
    database.exec(supplementalIndexes);
    database.exec(transaction === "nested" ? "RELEASE migrate_schema;" : "COMMIT;");
  } catch (error) {
    database.exec(
      transaction === "nested"
        ? "ROLLBACK TO migrate_schema; RELEASE migrate_schema;"
        : "ROLLBACK;",
    );
    throw error;
  }
}
