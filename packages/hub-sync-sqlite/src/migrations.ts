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
  `
    CREATE INDEX hub_events_project_run_seq
      ON hub_events (
        destination_id,
        project_id,
        json_extract(event_json, '$.runId'),
        seq
      );
  `,
  `
    ALTER TABLE hub_projects
      ADD COLUMN stored_event_count INTEGER NOT NULL DEFAULT 0
      CHECK (stored_event_count >= 0);
    ALTER TABLE hub_projects
      ADD COLUMN run_count INTEGER NOT NULL DEFAULT 0
      CHECK (run_count >= 0);

    CREATE TABLE hub_runs (
      destination_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      first_seq INTEGER NOT NULL CHECK (first_seq >= 1),
      last_seq INTEGER NOT NULL CHECK (last_seq >= first_seq),
      event_count INTEGER NOT NULL CHECK (event_count >= 1),
      continuous_event_count INTEGER NOT NULL
        CHECK (continuous_event_count >= 0 AND continuous_event_count <= event_count),
      PRIMARY KEY (destination_id, project_id, run_id),
      FOREIGN KEY (destination_id, project_id)
        REFERENCES hub_projects(destination_id, project_id)
    ) STRICT;
    CREATE INDEX hub_runs_project_first_seq
      ON hub_runs (destination_id, project_id, first_seq, run_id);

    CREATE TABLE hub_run_sessions (
      destination_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      first_seq INTEGER NOT NULL CHECK (first_seq >= 1),
      PRIMARY KEY (destination_id, project_id, run_id, session_id),
      FOREIGN KEY (destination_id, project_id, run_id)
        REFERENCES hub_runs(destination_id, project_id, run_id)
    ) STRICT;
    CREATE INDEX hub_run_sessions_first_seq
      ON hub_run_sessions (destination_id, project_id, run_id, first_seq, session_id);

    INSERT INTO hub_runs (
      destination_id, project_id, run_id, first_seq, last_seq,
      event_count, continuous_event_count
    )
    SELECT event.destination_id, event.project_id,
      json_extract(event.event_json, '$.runId'), MIN(event.seq), MAX(event.seq),
      COUNT(*), SUM(CASE WHEN event.seq <= project.cursor_seq THEN 1 ELSE 0 END)
    FROM hub_events AS event
    JOIN hub_projects AS project
      ON project.destination_id = event.destination_id
     AND project.project_id = event.project_id
    GROUP BY event.destination_id, event.project_id,
      json_extract(event.event_json, '$.runId');

    INSERT INTO hub_run_sessions (
      destination_id, project_id, run_id, session_id, first_seq
    )
    SELECT destination_id, project_id,
      json_extract(event_json, '$.runId'), json_extract(event_json, '$.sessionId'), MIN(seq)
    FROM hub_events
    GROUP BY destination_id, project_id,
      json_extract(event_json, '$.runId'), json_extract(event_json, '$.sessionId');

    UPDATE hub_projects
    SET stored_event_count = (
      SELECT COUNT(*) FROM hub_events AS event
      WHERE event.destination_id = hub_projects.destination_id
        AND event.project_id = hub_projects.project_id
    ), run_count = (
      SELECT COUNT(*) FROM hub_runs AS run
      WHERE run.destination_id = hub_projects.destination_id
        AND run.project_id = hub_projects.project_id
    );

    INSERT INTO hub_sync_meta (key, value) VALUES (
      'project_count', (SELECT CAST(COUNT(*) AS TEXT) FROM hub_projects)
    );
    INSERT INTO hub_sync_meta (key, value) VALUES (
      'event_count', (SELECT CAST(COUNT(*) AS TEXT) FROM hub_events)
    );
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
