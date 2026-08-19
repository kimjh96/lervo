import { type DatabaseSync } from "node:sqlite";

import { HubSyncStoreError } from "./errors.js";

const migrations = [
  `
    CREATE TABLE hub_sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE hub_projects (
      destination_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      registration_id TEXT NOT NULL UNIQUE,
      identity_hash TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      request_json TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cursor_seq INTEGER NOT NULL CHECK (cursor_seq >= 0),
      cursor_hash TEXT,
      PRIMARY KEY (destination_id, project_id),
      CHECK ((cursor_seq = 0 AND cursor_hash IS NULL) OR (cursor_seq > 0 AND cursor_hash IS NOT NULL))
    ) STRICT;
    CREATE TABLE hub_events (
      destination_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      seq INTEGER NOT NULL CHECK (seq >= 1),
      event_id TEXT NOT NULL,
      event_hash TEXT NOT NULL,
      previous_hash TEXT,
      event_json TEXT NOT NULL,
      PRIMARY KEY (destination_id, project_id, seq),
      UNIQUE (destination_id, project_id, event_id),
      UNIQUE (destination_id, project_id, event_hash),
      FOREIGN KEY (destination_id, project_id)
        REFERENCES hub_projects(destination_id, project_id)
    ) STRICT;
    CREATE INDEX hub_events_project_seq
      ON hub_events (destination_id, project_id, seq);
    CREATE TRIGGER hub_events_no_update BEFORE UPDATE ON hub_events
      BEGIN SELECT RAISE(ABORT, 'hub events are append-only'); END;
    CREATE TRIGGER hub_events_no_delete BEFORE DELETE ON hub_events
      BEGIN SELECT RAISE(ABORT, 'hub events are append-only'); END;
    CREATE TRIGGER hub_projects_no_delete BEFORE DELETE ON hub_projects
      BEGIN SELECT RAISE(ABORT, 'hub projects cannot be deleted'); END;
  `,
] as const;

export const hubSyncSchemaVersion = migrations.length;

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
    const version = database.prepare("PRAGMA user_version;").get()?.user_version;
    if (typeof version !== "number" || !Number.isSafeInteger(version)) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "Hub sync SQLite schema version을 읽을 수 없습니다.",
      );
    }
    if (version > hubSyncSchemaVersion) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "지원하지 않는 Hub sync SQLite schema입니다.",
      );
    }
    for (let index = version; index < migrations.length; index += 1) {
      database.exec(migrations[index] as string);
      database.exec(`PRAGMA user_version = ${index + 1};`);
    }
    const storedVersion = database.prepare(
      "SELECT value FROM hub_sync_meta WHERE key = ?",
    ).get("storage_schema_version")?.value;
    if (storedVersion === undefined) {
      database.prepare(
        "INSERT INTO hub_sync_meta (key, value) VALUES (?, ?)",
      ).run("storage_schema_version", String(hubSyncSchemaVersion));
    } else if (
      typeof storedVersion !== "string" ||
      !Number.isSafeInteger(Number(storedVersion)) ||
      Number(storedVersion) < 1 ||
      Number(storedVersion) > hubSyncSchemaVersion
    ) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "Hub sync SQLite metadata version이 유효하지 않습니다.",
      );
    } else if (Number(storedVersion) < hubSyncSchemaVersion) {
      database.prepare(
        "UPDATE hub_sync_meta SET value = ? WHERE key = ?",
      ).run(String(hubSyncSchemaVersion), "storage_schema_version");
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
