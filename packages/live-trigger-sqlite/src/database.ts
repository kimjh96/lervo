import { type DatabaseSync } from "node:sqlite";

import { prepareOwnerOnlyDatabasePath } from "@lervo/runtime-security";

import { LiveTriggerSQLiteError } from "./errors.js";

export async function ensureLiveTriggerDatabasePath(path: string): Promise<string> {
  return prepareOwnerOnlyDatabasePath(path);
}

export function configureLiveTriggerDatabase(database: DatabaseSync): void {
  const defensive = database as DatabaseSync & { enableDefensive?: (active: boolean) => void };
  defensive.enableDefensive?.(true);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
}

export function migrateLiveTriggerDatabase(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const version = database.prepare("PRAGMA user_version;").get()?.user_version;
    if (version !== 0 && version !== 1) {
      throw new LiveTriggerSQLiteError("integrity_failed", "Unsupported live-trigger schema.");
    }
    if (version === 0) {
      database.exec(`
        CREATE TABLE live_trigger_reservation (
          source_event_key_hash TEXT PRIMARY KEY,
          reservation_id TEXT NOT NULL UNIQUE,
          invocation_fingerprint_hash TEXT NOT NULL,
          plan_id TEXT NOT NULL,
          authorization_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('reserved', 'recovery_required', 'completed')),
          completion_json TEXT,
          reserved_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK((status = 'completed') = (completion_json IS NOT NULL))
        ) STRICT;
        CREATE INDEX live_trigger_authorization_budget
          ON live_trigger_reservation(authorization_hash);
        CREATE INDEX live_trigger_completed_retention
          ON live_trigger_reservation(status, updated_at);
        CREATE TABLE live_trigger_authorization_usage (
          authorization_hash TEXT PRIMARY KEY,
          accepted_count INTEGER NOT NULL CHECK(accepted_count >= 0)
        ) STRICT;
        CREATE TRIGGER live_trigger_authorization_usage_no_delete
          BEFORE DELETE ON live_trigger_authorization_usage
          BEGIN SELECT RAISE(ABORT, 'live-trigger authorization usage cannot be deleted'); END;
        CREATE TRIGGER live_trigger_authorization_usage_monotonic
          BEFORE UPDATE ON live_trigger_authorization_usage
          WHEN NEW.authorization_hash != OLD.authorization_hash
            OR NEW.accepted_count < OLD.accepted_count
          BEGIN SELECT RAISE(ABORT, 'live-trigger authorization usage must be monotonic'); END;
        CREATE TRIGGER live_trigger_coordinates_immutable
          BEFORE UPDATE ON live_trigger_reservation
          WHEN OLD.source_event_key_hash != NEW.source_event_key_hash
            OR OLD.reservation_id != NEW.reservation_id
            OR OLD.invocation_fingerprint_hash != NEW.invocation_fingerprint_hash
            OR OLD.plan_id != NEW.plan_id
            OR OLD.authorization_hash != NEW.authorization_hash
            OR OLD.reserved_at != NEW.reserved_at
          BEGIN SELECT RAISE(ABORT, 'live-trigger coordinates are immutable'); END;
        CREATE TRIGGER live_trigger_status_forward
          BEFORE UPDATE ON live_trigger_reservation
          WHEN NEW.updated_at < OLD.updated_at
            OR (OLD.status = 'completed' AND
              (NEW.status != OLD.status OR NEW.completion_json != OLD.completion_json))
            OR (OLD.status = 'recovery_required' AND NEW.status = 'reserved')
          BEGIN SELECT RAISE(ABORT, 'live-trigger state must move forward'); END;
        PRAGMA user_version = 1;
      `);
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
