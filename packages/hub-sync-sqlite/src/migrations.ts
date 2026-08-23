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
  `
    CREATE TABLE hub_remote_commands (
      delivery_id TEXT PRIMARY KEY,
      destination_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      command_hash TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      queued_at_ms INTEGER NOT NULL CHECK (queued_at_ms >= 0),
      issued_at TEXT NOT NULL,
      issued_at_ms INTEGER NOT NULL CHECK (issued_at_ms >= 0),
      expires_at TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0),
      status TEXT NOT NULL
        CHECK (status IN ('pending', 'leased', 'completed', 'rejected', 'expired')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      lease_id TEXT,
      lease_owner TEXT,
      leased_at TEXT,
      lease_expires_at TEXT,
      lease_expires_at_ms INTEGER,
      acknowledgement_json TEXT,
      acknowledgement_hash TEXT,
      terminal_at TEXT,
      UNIQUE (destination_id, project_id, command_id),
      FOREIGN KEY (destination_id, project_id)
        REFERENCES hub_projects(destination_id, project_id),
      CHECK (
        (status = 'pending' AND lease_id IS NULL AND lease_owner IS NULL
          AND leased_at IS NULL AND lease_expires_at IS NULL
          AND lease_expires_at_ms IS NULL
          AND acknowledgement_json IS NULL AND acknowledgement_hash IS NULL
          AND terminal_at IS NULL)
        OR
        (status = 'leased' AND lease_id IS NOT NULL AND lease_owner IS NOT NULL
          AND leased_at IS NOT NULL AND lease_expires_at IS NOT NULL
          AND lease_expires_at_ms IS NOT NULL
          AND acknowledgement_json IS NULL AND acknowledgement_hash IS NULL
          AND terminal_at IS NULL)
        OR
        (status IN ('completed', 'rejected') AND lease_id IS NULL AND lease_owner IS NULL
          AND leased_at IS NULL AND lease_expires_at IS NULL
          AND lease_expires_at_ms IS NULL
          AND acknowledgement_json IS NOT NULL AND acknowledgement_hash IS NOT NULL
          AND terminal_at IS NOT NULL)
        OR
        (status = 'expired' AND lease_id IS NULL AND lease_owner IS NULL
          AND leased_at IS NULL AND lease_expires_at IS NULL
          AND lease_expires_at_ms IS NULL
          AND acknowledgement_json IS NULL AND acknowledgement_hash IS NULL
          AND terminal_at IS NOT NULL)
      )
    ) STRICT;
    CREATE INDEX hub_remote_commands_ready
      ON hub_remote_commands (
        destination_id, project_id, status, expires_at, queued_at, delivery_id
      );
    CREATE TRIGGER hub_remote_commands_no_delete BEFORE DELETE ON hub_remote_commands
      BEGIN SELECT RAISE(ABORT, 'hub remote commands cannot be deleted'); END;
    CREATE TRIGGER hub_remote_commands_identity_immutable
      BEFORE UPDATE ON hub_remote_commands
      WHEN OLD.delivery_id != NEW.delivery_id
        OR OLD.destination_id != NEW.destination_id
        OR OLD.project_id != NEW.project_id
        OR OLD.command_id != NEW.command_id
        OR OLD.command_hash != NEW.command_hash
        OR OLD.envelope_json != NEW.envelope_json
        OR OLD.queued_at != NEW.queued_at
        OR OLD.queued_at_ms != NEW.queued_at_ms
        OR OLD.issued_at != NEW.issued_at
        OR OLD.issued_at_ms != NEW.issued_at_ms
        OR OLD.expires_at != NEW.expires_at
        OR OLD.expires_at_ms != NEW.expires_at_ms
      BEGIN SELECT RAISE(ABORT, 'hub remote command identity is immutable'); END;
  `,
  `
    CREATE TABLE hub_policy_snapshots (
      destination_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      snapshot_id TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      published_at TEXT NOT NULL,
      PRIMARY KEY (destination_id, project_id, sequence),
      UNIQUE (destination_id, project_id, snapshot_id),
      FOREIGN KEY (destination_id, project_id)
        REFERENCES hub_projects(destination_id, project_id)
    ) STRICT;
    CREATE INDEX hub_policy_snapshots_project_id
      ON hub_policy_snapshots (destination_id, project_id, snapshot_id);

    CREATE TABLE hub_policy_approvals (
      approval_id TEXT NOT NULL,
      destination_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      published_at TEXT NOT NULL,
      PRIMARY KEY (destination_id, project_id, approval_id),
      FOREIGN KEY (destination_id, project_id, snapshot_id)
        REFERENCES hub_policy_snapshots(destination_id, project_id, snapshot_id),
      FOREIGN KEY (destination_id, project_id, command_id)
        REFERENCES hub_remote_commands(destination_id, project_id, command_id)
    ) STRICT;
    CREATE INDEX hub_policy_approvals_snapshot
      ON hub_policy_approvals (destination_id, project_id, snapshot_id, approval_id);

    CREATE TABLE hub_policy_revocations (
      revocation_id TEXT NOT NULL,
      approval_id TEXT NOT NULL,
      destination_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      published_at TEXT NOT NULL,
      PRIMARY KEY (destination_id, project_id, revocation_id),
      UNIQUE (destination_id, project_id, approval_id),
      FOREIGN KEY (destination_id, project_id, approval_id)
        REFERENCES hub_policy_approvals(destination_id, project_id, approval_id)
    ) STRICT;
    CREATE INDEX hub_policy_revocations_project
      ON hub_policy_revocations (destination_id, project_id, revocation_id);

    CREATE TRIGGER hub_policy_snapshots_no_update BEFORE UPDATE ON hub_policy_snapshots
      BEGIN SELECT RAISE(ABORT, 'hub policy snapshots are append-only'); END;
    CREATE TRIGGER hub_policy_snapshots_no_delete BEFORE DELETE ON hub_policy_snapshots
      BEGIN SELECT RAISE(ABORT, 'hub policy snapshots are append-only'); END;
    CREATE TRIGGER hub_policy_approvals_no_update BEFORE UPDATE ON hub_policy_approvals
      BEGIN SELECT RAISE(ABORT, 'hub policy approvals are append-only'); END;
    CREATE TRIGGER hub_policy_approvals_no_delete BEFORE DELETE ON hub_policy_approvals
      BEGIN SELECT RAISE(ABORT, 'hub policy approvals are append-only'); END;
    CREATE TRIGGER hub_policy_revocations_no_update BEFORE UPDATE ON hub_policy_revocations
      BEGIN SELECT RAISE(ABORT, 'hub policy revocations are append-only'); END;
    CREATE TRIGGER hub_policy_revocations_no_delete BEFORE DELETE ON hub_policy_revocations
      BEGIN SELECT RAISE(ABORT, 'hub policy revocations are append-only'); END;
  `,
  `
    CREATE TABLE hub_knowledge_graph_relations (
      destination_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      relation_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      from_kind TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_kind TEXT NOT NULL,
      to_id TEXT NOT NULL,
      evidence_event_id TEXT NOT NULL,
      evidence_event_type TEXT NOT NULL,
      evidence_run_id TEXT NOT NULL,
      evidence_seq INTEGER NOT NULL CHECK (evidence_seq >= 1),
      PRIMARY KEY (destination_id, project_id, relation_id),
      FOREIGN KEY (destination_id, project_id)
        REFERENCES hub_projects(destination_id, project_id),
      FOREIGN KEY (destination_id, project_id, evidence_seq)
        REFERENCES hub_events(destination_id, project_id, seq)
    ) STRICT;
    CREATE INDEX hub_knowledge_graph_from
      ON hub_knowledge_graph_relations (
        destination_id, project_id, from_kind, from_id, relation_id
      );
    CREATE INDEX hub_knowledge_graph_to
      ON hub_knowledge_graph_relations (
        destination_id, project_id, to_kind, to_id, relation_id
      );
    INSERT INTO hub_sync_meta (key, value) VALUES ('knowledge_graph_index_version', '0');
  `,
  `
    CREATE TABLE hub_remote_command_authorships (
      destination_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      submission_hash TEXT NOT NULL,
      author_subject_hash TEXT NOT NULL,
      delivery_id TEXT NOT NULL UNIQUE,
      artifact_id TEXT NOT NULL,
      artifact_uri TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 65536),
      media_type TEXT NOT NULL CHECK (media_type = 'text/plain; charset=utf-8'),
      PRIMARY KEY (destination_id, project_id, idempotency_key),
      FOREIGN KEY (destination_id, project_id)
        REFERENCES hub_projects(destination_id, project_id),
      FOREIGN KEY (delivery_id) REFERENCES hub_remote_commands(delivery_id)
    ) STRICT;
    CREATE INDEX hub_remote_command_artifacts
      ON hub_remote_command_authorships (destination_id, project_id, artifact_id);
    CREATE TRIGGER hub_remote_command_authorships_no_update
      BEFORE UPDATE ON hub_remote_command_authorships
      BEGIN SELECT RAISE(ABORT, 'hub remote command authorships are append-only'); END;
    CREATE TRIGGER hub_remote_command_authorships_no_delete
      BEFORE DELETE ON hub_remote_command_authorships
      BEGIN SELECT RAISE(ABORT, 'hub remote command authorships are append-only'); END;
  `,
  `
    CREATE TABLE hub_remote_command_artifact_retentions (
      delivery_id TEXT PRIMARY KEY,
      artifact_uri TEXT NOT NULL,
      retain_until TEXT NOT NULL,
      retain_until_ms INTEGER NOT NULL CHECK (retain_until_ms >= 0),
      FOREIGN KEY (delivery_id) REFERENCES hub_remote_command_authorships(delivery_id)
    ) STRICT;
    INSERT INTO hub_remote_command_artifact_retentions (
      delivery_id, artifact_uri, retain_until, retain_until_ms
    )
    SELECT authorship.delivery_id, authorship.artifact_uri,
      strftime('%Y-%m-%dT%H:%M:%fZ',
        (command.queued_at_ms + 2592000000) / 1000.0, 'unixepoch'),
      command.queued_at_ms + 2592000000
    FROM hub_remote_command_authorships AS authorship
    JOIN hub_remote_commands AS command ON command.delivery_id = authorship.delivery_id;
    CREATE INDEX hub_remote_command_artifact_retention_due
      ON hub_remote_command_artifact_retentions (retain_until_ms, artifact_uri);
    CREATE TRIGGER hub_remote_command_artifact_retentions_no_update
      BEFORE UPDATE ON hub_remote_command_artifact_retentions
      BEGIN SELECT RAISE(ABORT, 'hub remote command artifact retentions are append-only'); END;
    CREATE TRIGGER hub_remote_command_artifact_retentions_no_delete
      BEFORE DELETE ON hub_remote_command_artifact_retentions
      BEGIN SELECT RAISE(ABORT, 'hub remote command artifact retentions are append-only'); END;

    CREATE TABLE hub_remote_command_artifact_gc_claims (
      artifact_uri TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('expired', 'orphan')),
      worker_id TEXT NOT NULL,
      observed_modified_at TEXT,
      observed_modified_at_ms INTEGER CHECK (observed_modified_at_ms IS NULL OR observed_modified_at_ms >= 0),
      claimed_at TEXT NOT NULL,
      claimed_at_ms INTEGER NOT NULL CHECK (claimed_at_ms >= 0),
      lease_expires_at TEXT NOT NULL,
      lease_expires_at_ms INTEGER NOT NULL CHECK (lease_expires_at_ms > claimed_at_ms),
      CHECK (
        (kind = 'expired' AND observed_modified_at IS NULL AND observed_modified_at_ms IS NULL) OR
        (kind = 'orphan' AND observed_modified_at IS NOT NULL AND observed_modified_at_ms IS NOT NULL)
      )
    ) STRICT;
    CREATE INDEX hub_remote_command_artifact_gc_claim_leases
      ON hub_remote_command_artifact_gc_claims (lease_expires_at_ms);

    CREATE TABLE hub_remote_command_artifact_purges (
      delivery_id TEXT PRIMARY KEY,
      artifact_uri TEXT NOT NULL,
      claim_id TEXT NOT NULL,
      purged_at TEXT NOT NULL,
      purged_at_ms INTEGER NOT NULL CHECK (purged_at_ms >= 0),
      FOREIGN KEY (delivery_id) REFERENCES hub_remote_command_authorships(delivery_id)
    ) STRICT;
    CREATE INDEX hub_remote_command_artifact_purges_uri
      ON hub_remote_command_artifact_purges (artifact_uri, claim_id);
    CREATE TRIGGER hub_remote_command_artifact_purges_no_update
      BEFORE UPDATE ON hub_remote_command_artifact_purges
      BEGIN SELECT RAISE(ABORT, 'hub remote command artifact purges are append-only'); END;
    CREATE TRIGGER hub_remote_command_artifact_purges_no_delete
      BEFORE DELETE ON hub_remote_command_artifact_purges
      BEGIN SELECT RAISE(ABORT, 'hub remote command artifact purges are append-only'); END;

    CREATE TABLE hub_remote_command_artifact_gc_completions (
      claim_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('expired', 'orphan')),
      artifact_uri TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      purged_delivery_count INTEGER NOT NULL CHECK (purged_delivery_count >= 0),
      completed_at TEXT NOT NULL,
      completed_at_ms INTEGER NOT NULL CHECK (completed_at_ms >= 0)
    ) STRICT;
    CREATE TRIGGER hub_remote_command_artifact_gc_completions_no_update
      BEFORE UPDATE ON hub_remote_command_artifact_gc_completions
      BEGIN SELECT RAISE(ABORT, 'hub remote command artifact completions are append-only'); END;
    CREATE TRIGGER hub_remote_command_artifact_gc_completions_no_delete
      BEFORE DELETE ON hub_remote_command_artifact_gc_completions
      BEGIN SELECT RAISE(ABORT, 'hub remote command artifact completions are append-only'); END;
  `,
  `
    ALTER TABLE hub_remote_command_artifact_gc_completions
      ADD COLUMN completion_status TEXT NOT NULL DEFAULT 'completed'
      CHECK (completion_status IN ('completed', 'partial'));
    CREATE INDEX hub_remote_command_artifact_gc_completion_uri
      ON hub_remote_command_artifact_gc_completions (
        artifact_uri, completion_status, completed_at_ms
      );

    CREATE TABLE hub_remote_command_artifact_cleanup_runtime (
      runtime_key TEXT PRIMARY KEY CHECK (runtime_key = 'command_artifact_cleanup'),
      inventory_cursor TEXT,
      next_cycle_at TEXT NOT NULL,
      next_cycle_at_ms INTEGER NOT NULL CHECK (next_cycle_at_ms >= 0),
      lease_id TEXT,
      lease_owner TEXT,
      lease_claimed_at TEXT,
      lease_claimed_at_ms INTEGER,
      lease_expires_at TEXT,
      lease_expires_at_ms INTEGER,
      cycle_count INTEGER NOT NULL CHECK (cycle_count >= 0),
      last_cycle_at TEXT,
      last_cycle_at_ms INTEGER,
      last_status TEXT CHECK (last_status IS NULL OR last_status IN ('completed', 'failed')),
      last_failure_code TEXT CHECK (
        last_failure_code IS NULL OR last_failure_code = 'artifact_cleanup_cycle_failed'
      ),
      last_claimed_count INTEGER CHECK (last_claimed_count IS NULL OR last_claimed_count >= 0),
      last_deleted_count INTEGER CHECK (last_deleted_count IS NULL OR last_deleted_count >= 0),
      last_already_missing_count INTEGER CHECK (
        last_already_missing_count IS NULL OR last_already_missing_count >= 0
      ),
      last_purged_delivery_count INTEGER CHECK (
        last_purged_delivery_count IS NULL OR last_purged_delivery_count >= 0
      ),
      last_orphan_purged_count INTEGER CHECK (
        last_orphan_purged_count IS NULL OR last_orphan_purged_count >= 0
      ),
      last_failure_count INTEGER CHECK (last_failure_count IS NULL OR last_failure_count >= 0),
      last_continuation_recommended INTEGER CHECK (
        last_continuation_recommended IS NULL OR last_continuation_recommended IN (0, 1)
      ),
      CHECK (
        (lease_id IS NULL AND lease_owner IS NULL AND lease_claimed_at IS NULL AND
          lease_claimed_at_ms IS NULL AND lease_expires_at IS NULL AND
          lease_expires_at_ms IS NULL) OR
        (lease_id IS NOT NULL AND lease_owner IS NOT NULL AND lease_claimed_at IS NOT NULL AND
          lease_claimed_at_ms IS NOT NULL AND lease_expires_at IS NOT NULL AND
          lease_expires_at_ms > lease_claimed_at_ms)
      ),
      CHECK (
        (last_status IS NULL AND cycle_count = 0 AND last_cycle_at IS NULL AND
          last_cycle_at_ms IS NULL AND last_failure_code IS NULL AND
          last_claimed_count IS NULL AND last_deleted_count IS NULL AND
          last_already_missing_count IS NULL AND last_purged_delivery_count IS NULL AND
          last_orphan_purged_count IS NULL AND last_failure_count IS NULL AND
          last_continuation_recommended IS NULL) OR
        (last_status = 'failed' AND cycle_count > 0 AND last_cycle_at IS NOT NULL AND
          last_cycle_at_ms IS NOT NULL AND
          last_failure_code = 'artifact_cleanup_cycle_failed' AND
          last_claimed_count IS NULL AND last_deleted_count IS NULL AND
          last_already_missing_count IS NULL AND last_purged_delivery_count IS NULL AND
          last_orphan_purged_count IS NULL AND last_failure_count IS NULL AND
          last_continuation_recommended IS NULL) OR
        (last_status = 'completed' AND cycle_count > 0 AND last_cycle_at IS NOT NULL AND
          last_cycle_at_ms IS NOT NULL AND last_failure_code IS NULL AND
          last_claimed_count IS NOT NULL AND last_deleted_count IS NOT NULL AND
          last_already_missing_count IS NOT NULL AND last_purged_delivery_count IS NOT NULL AND
          last_orphan_purged_count IS NOT NULL AND last_failure_count IS NOT NULL AND
          last_continuation_recommended IS NOT NULL AND
          last_purged_delivery_count <=
            (last_deleted_count + last_already_missing_count) * 100)
      )
    ) STRICT;
    INSERT INTO hub_remote_command_artifact_cleanup_runtime (
      runtime_key, inventory_cursor, next_cycle_at, next_cycle_at_ms, cycle_count
    ) VALUES ('command_artifact_cleanup', NULL, '1970-01-01T00:00:00.000Z', 0, 0);
    CREATE TRIGGER hub_remote_command_artifact_cleanup_runtime_no_delete
      BEFORE DELETE ON hub_remote_command_artifact_cleanup_runtime
      BEGIN SELECT RAISE(ABORT, 'hub remote command artifact cleanup runtime cannot be deleted'); END;
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
        "The Hub sync SQLite schema version cannot be read.",
      );
    }
    if (version > hubSyncSchemaVersion) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "This Hub sync SQLite schema is not supported.",
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
        "The Hub sync SQLite metadata version is invalid.",
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
