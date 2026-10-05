import { lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { OrganizationDeploymentSQLiteError } from "./errors.js";
import { sqliteRow } from "./sqlite-row.js";

export async function ensureOrganizationRolloutDatabasePath(path: string): Promise<string> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  try {
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new OrganizationDeploymentSQLiteError(
        "integrity_failed",
        "The organization rollout replay path must be a regular file.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

export function configureOrganizationRolloutDatabase(database: DatabaseSync): void {
  const defensive = database as DatabaseSync & { enableDefensive?: (active: boolean) => void };
  defensive.enableDefensive?.(true);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
}

export function migrateOrganizationRolloutDatabase(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const version = sqliteRow(database.prepare("PRAGMA user_version;").get())?.user_version;
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3) {
      throw new OrganizationDeploymentSQLiteError(
        "integrity_failed",
        "The organization rollout replay schema is unsupported.",
      );
    }
    if (version === 0) {
      database.exec(`
        CREATE TABLE organization_rollout_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT;
        CREATE TABLE organization_rollout_replay (
          idempotency_key TEXT PRIMARY KEY,
          delivery_hash TEXT NOT NULL,
          nonce TEXT NOT NULL UNIQUE,
          reservation_id TEXT NOT NULL UNIQUE,
          receipt_json TEXT,
          baseline_json TEXT,
          recovery_json TEXT
        ) STRICT;
        CREATE TRIGGER organization_rollout_replay_no_delete
          BEFORE DELETE ON organization_rollout_replay
          BEGIN SELECT RAISE(ABORT, 'organization rollout replay records cannot be deleted'); END;
        CREATE TRIGGER organization_rollout_replay_coordinate_immutable
          BEFORE UPDATE ON organization_rollout_replay
          WHEN OLD.idempotency_key != NEW.idempotency_key
            OR OLD.delivery_hash != NEW.delivery_hash
            OR OLD.nonce != NEW.nonce
            OR OLD.reservation_id != NEW.reservation_id
            OR OLD.baseline_json IS NOT NEW.baseline_json
            OR OLD.receipt_json IS NOT NULL
          BEGIN SELECT RAISE(ABORT, 'organization rollout replay coordinates are immutable'); END;
        CREATE TABLE organization_rollback_replay (
          idempotency_key TEXT PRIMARY KEY,
          delivery_hash TEXT NOT NULL,
          nonce TEXT NOT NULL UNIQUE,
          reservation_id TEXT NOT NULL UNIQUE,
          receipt_json TEXT,
          baseline_json TEXT NOT NULL,
          recovery_json TEXT
        ) STRICT;
        CREATE TRIGGER organization_rollback_replay_no_delete
          BEFORE DELETE ON organization_rollback_replay
          BEGIN SELECT RAISE(ABORT, 'organization rollback replay records cannot be deleted'); END;
        CREATE TRIGGER organization_rollback_replay_coordinate_immutable
          BEFORE UPDATE ON organization_rollback_replay
          WHEN OLD.idempotency_key != NEW.idempotency_key
            OR OLD.delivery_hash != NEW.delivery_hash
            OR OLD.nonce != NEW.nonce
            OR OLD.reservation_id != NEW.reservation_id
            OR OLD.baseline_json != NEW.baseline_json
            OR OLD.receipt_json IS NOT NULL
          BEGIN SELECT RAISE(ABORT, 'organization rollback replay coordinates are immutable'); END;
        PRAGMA user_version = 3;
      `);
    }
    if (version === 1) {
      database.exec(`
        ALTER TABLE organization_rollout_replay ADD COLUMN baseline_json TEXT;
        ALTER TABLE organization_rollout_replay ADD COLUMN recovery_json TEXT;
        DROP TRIGGER organization_rollout_replay_coordinate_immutable;
        CREATE TRIGGER organization_rollout_replay_coordinate_immutable
          BEFORE UPDATE ON organization_rollout_replay
          WHEN OLD.idempotency_key != NEW.idempotency_key
            OR OLD.delivery_hash != NEW.delivery_hash
            OR OLD.nonce != NEW.nonce
            OR OLD.reservation_id != NEW.reservation_id
            OR OLD.baseline_json IS NOT NEW.baseline_json
            OR OLD.receipt_json IS NOT NULL
          BEGIN SELECT RAISE(ABORT, 'organization rollout replay coordinates are immutable'); END;
        CREATE TABLE organization_rollback_replay (
          idempotency_key TEXT PRIMARY KEY,
          delivery_hash TEXT NOT NULL,
          nonce TEXT NOT NULL UNIQUE,
          reservation_id TEXT NOT NULL UNIQUE,
          receipt_json TEXT,
          baseline_json TEXT NOT NULL,
          recovery_json TEXT
        ) STRICT;
        CREATE TRIGGER organization_rollback_replay_no_delete
          BEFORE DELETE ON organization_rollback_replay
          BEGIN SELECT RAISE(ABORT, 'organization rollback replay records cannot be deleted'); END;
        CREATE TRIGGER organization_rollback_replay_coordinate_immutable
          BEFORE UPDATE ON organization_rollback_replay
          WHEN OLD.idempotency_key != NEW.idempotency_key
            OR OLD.delivery_hash != NEW.delivery_hash
            OR OLD.nonce != NEW.nonce
            OR OLD.reservation_id != NEW.reservation_id
            OR OLD.baseline_json != NEW.baseline_json
            OR OLD.receipt_json IS NOT NULL
          BEGIN SELECT RAISE(ABORT, 'organization rollback replay coordinates are immutable'); END;
        PRAGMA user_version = 3;
      `);
    }
    if (version === 2) {
      database.exec(`
        CREATE TABLE organization_rollback_replay (
          idempotency_key TEXT PRIMARY KEY,
          delivery_hash TEXT NOT NULL,
          nonce TEXT NOT NULL UNIQUE,
          reservation_id TEXT NOT NULL UNIQUE,
          receipt_json TEXT,
          baseline_json TEXT NOT NULL,
          recovery_json TEXT
        ) STRICT;
        CREATE TRIGGER organization_rollback_replay_no_delete
          BEFORE DELETE ON organization_rollback_replay
          BEGIN SELECT RAISE(ABORT, 'organization rollback replay records cannot be deleted'); END;
        CREATE TRIGGER organization_rollback_replay_coordinate_immutable
          BEFORE UPDATE ON organization_rollback_replay
          WHEN OLD.idempotency_key != NEW.idempotency_key
            OR OLD.delivery_hash != NEW.delivery_hash
            OR OLD.nonce != NEW.nonce
            OR OLD.reservation_id != NEW.reservation_id
            OR OLD.baseline_json != NEW.baseline_json
            OR OLD.receipt_json IS NOT NULL
          BEGIN SELECT RAISE(ABORT, 'organization rollback replay coordinates are immutable'); END;
        PRAGMA user_version = 3;
      `);
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
