import { lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { InteractionSQLiteError } from "./errors.js";

export const interactionSQLiteSchemaVersion = 1;

export async function ensureInteractionDatabasePath(path: string): Promise<string> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  try {
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "Interaction SQLite 경로는 일반 파일이어야 합니다.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

export function configureInteractionDatabase(database: DatabaseSync): void {
  const defensive = database as DatabaseSync & { enableDefensive?: (active: boolean) => void };
  defensive.enableDefensive?.(true);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
}

export function migrateInteractionDatabase(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const version = database.prepare("PRAGMA user_version;").get()?.user_version;
    if (version !== 0 && version !== interactionSQLiteSchemaVersion) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "지원하지 않는 Interaction SQLite schema입니다.",
      );
    }
    if (version === 0) {
      database.exec(`
        CREATE TABLE interaction_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT;
        INSERT INTO interaction_meta (key, value)
          VALUES ('storage_schema_version', '1');

        CREATE TABLE conversation_inbox (
          event_id TEXT NOT NULL,
          policy_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          integration_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          event_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'completed')),
          available_at_ms INTEGER NOT NULL CHECK (available_at_ms >= 0),
          attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
          lease_id TEXT,
          lease_owner TEXT,
          lease_expires_at_ms INTEGER,
          last_failure_code TEXT,
          last_failed_at_ms INTEGER,
          PRIMARY KEY (event_id, role_id),
          CHECK (
            (status = 'pending' AND lease_id IS NULL AND lease_owner IS NULL
              AND lease_expires_at_ms IS NULL)
            OR
            (status = 'leased' AND lease_id IS NOT NULL AND lease_owner IS NOT NULL
              AND lease_expires_at_ms IS NOT NULL)
            OR
            (status = 'completed' AND lease_id IS NULL AND lease_owner IS NULL
              AND lease_expires_at_ms IS NULL)
          ),
          CHECK (
            (last_failure_code IS NULL AND last_failed_at_ms IS NULL)
            OR (last_failure_code IS NOT NULL AND last_failed_at_ms IS NOT NULL)
          )
        ) STRICT;
        CREATE INDEX conversation_inbox_ready
          ON conversation_inbox (status, available_at_ms, event_id, role_id);

        CREATE TABLE conversation_participation_decisions (
          decision_id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          policy_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('observe', 'respond')),
          decided_at_ms INTEGER NOT NULL CHECK (decided_at_ms >= 0),
          decision_json TEXT NOT NULL,
          UNIQUE (event_id, role_id),
          FOREIGN KEY (event_id, role_id)
            REFERENCES conversation_inbox(event_id, role_id)
        ) STRICT;
        CREATE INDEX conversation_decisions_window
          ON conversation_participation_decisions (
            policy_id, conversation_id, action, decided_at_ms
          );

        CREATE TABLE conversation_outbox (
          outbound_id TEXT PRIMARY KEY,
          source_event_id TEXT NOT NULL,
          policy_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          integration_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          outbound_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'delivered')),
          available_at_ms INTEGER NOT NULL CHECK (available_at_ms >= 0),
          attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
          lease_id TEXT,
          lease_owner TEXT,
          lease_expires_at_ms INTEGER,
          last_failure_code TEXT,
          last_failed_at_ms INTEGER,
          receipt_json TEXT,
          delivered_at_ms INTEGER,
          UNIQUE (source_event_id, role_id),
          FOREIGN KEY (source_event_id, role_id)
            REFERENCES conversation_inbox(event_id, role_id),
          CHECK (
            (status = 'pending' AND lease_id IS NULL AND lease_owner IS NULL
              AND lease_expires_at_ms IS NULL AND receipt_json IS NULL
              AND delivered_at_ms IS NULL)
            OR
            (status = 'leased' AND lease_id IS NOT NULL AND lease_owner IS NOT NULL
              AND lease_expires_at_ms IS NOT NULL AND receipt_json IS NULL
              AND delivered_at_ms IS NULL)
            OR
            (status = 'delivered' AND lease_id IS NULL AND lease_owner IS NULL
              AND lease_expires_at_ms IS NULL AND receipt_json IS NOT NULL
              AND delivered_at_ms IS NOT NULL)
          ),
          CHECK (
            (last_failure_code IS NULL AND last_failed_at_ms IS NULL)
            OR (last_failure_code IS NOT NULL AND last_failed_at_ms IS NOT NULL)
          )
        ) STRICT;
        CREATE INDEX conversation_outbox_ready
          ON conversation_outbox (integration_id, status, available_at_ms, outbound_id);

        CREATE TRIGGER conversation_inbox_identity_immutable
          BEFORE UPDATE ON conversation_inbox
          WHEN OLD.event_id != NEW.event_id
            OR OLD.integration_id != NEW.integration_id
            OR OLD.policy_id != NEW.policy_id
            OR OLD.role_id != NEW.role_id
            OR OLD.project_id != NEW.project_id
            OR OLD.conversation_id != NEW.conversation_id
            OR OLD.event_json != NEW.event_json
          BEGIN SELECT RAISE(ABORT, 'conversation inbox identity is immutable'); END;
        CREATE TRIGGER conversation_inbox_lifecycle_guard
          BEFORE UPDATE ON conversation_inbox
          WHEN NOT (
            (OLD.status = 'pending' AND NEW.status = 'leased')
            OR (OLD.status = 'leased' AND NEW.status IN ('pending', 'leased', 'completed'))
          )
          BEGIN SELECT RAISE(ABORT, 'conversation inbox lifecycle is invalid'); END;
        CREATE TRIGGER conversation_inbox_no_delete BEFORE DELETE ON conversation_inbox
          BEGIN SELECT RAISE(ABORT, 'conversation inbox cannot be deleted'); END;
        CREATE TRIGGER conversation_decisions_immutable
          BEFORE UPDATE ON conversation_participation_decisions
          BEGIN SELECT RAISE(ABORT, 'conversation decisions are immutable'); END;
        CREATE TRIGGER conversation_decisions_no_delete
          BEFORE DELETE ON conversation_participation_decisions
          BEGIN SELECT RAISE(ABORT, 'conversation decisions cannot be deleted'); END;
        CREATE TRIGGER conversation_outbox_identity_immutable
          BEFORE UPDATE ON conversation_outbox
          WHEN OLD.outbound_id != NEW.outbound_id
            OR OLD.source_event_id != NEW.source_event_id
            OR OLD.policy_id != NEW.policy_id
            OR OLD.role_id != NEW.role_id
            OR OLD.integration_id != NEW.integration_id
            OR OLD.project_id != NEW.project_id
            OR OLD.conversation_id != NEW.conversation_id
            OR OLD.outbound_json != NEW.outbound_json
          BEGIN SELECT RAISE(ABORT, 'conversation outbox identity is immutable'); END;
        CREATE TRIGGER conversation_outbox_lifecycle_guard
          BEFORE UPDATE ON conversation_outbox
          WHEN NOT (
            (OLD.status = 'pending' AND NEW.status = 'leased')
            OR (OLD.status = 'leased' AND NEW.status IN ('pending', 'leased', 'delivered'))
          )
          BEGIN SELECT RAISE(ABORT, 'conversation outbox lifecycle is invalid'); END;
        CREATE TRIGGER conversation_outbox_no_delete BEFORE DELETE ON conversation_outbox
          BEGIN SELECT RAISE(ABORT, 'conversation outbox cannot be deleted'); END;
        PRAGMA user_version = 1;
      `);
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
