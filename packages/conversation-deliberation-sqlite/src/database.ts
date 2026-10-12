import { chmod, lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { ConversationDeliberationSQLiteError } from "./errors.js";
import { createConversationDeliberationNotificationSchema } from "./notification-database.js";
import { sqliteRow } from "./sqlite-row.js";

export const conversationDeliberationSQLiteSchemaVersion = 4;

export async function prepareConversationDeliberationDatabasePath(path: string): Promise<string> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  try {
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "The conversation deliberation queue path must be a regular file.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

export async function restrictConversationDeliberationDatabase(path: string): Promise<void> {
  await chmod(path, 0o600);
}

export function configureConversationDeliberationDatabase(database: DatabaseSync): void {
  const defensive = database as DatabaseSync & { enableDefensive?: (active: boolean) => void };
  defensive.enableDefensive?.(true);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
  `);
}

export function migrateConversationDeliberationDatabase(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const version = sqliteRow(database.prepare("PRAGMA user_version;").get())?.user_version;
    if (
      version !== 0 &&
      version !== 1 &&
      version !== 2 &&
      version !== 3 &&
      version !== conversationDeliberationSQLiteSchemaVersion
    ) {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "The conversation deliberation queue schema is unsupported.",
      );
    }
    if (version === 0) {
      database.exec(`
        CREATE TABLE conversation_deliberation_jobs (
          project_id TEXT NOT NULL,
          source_event_id TEXT NOT NULL,
          deliberation_id TEXT NOT NULL UNIQUE,
          request_hash TEXT NOT NULL,
          principal_hash TEXT NOT NULL,
          origin_conversation_id TEXT,
          origin_thread_id TEXT,
          origin_requester_participant_id TEXT,
          origin_binding_digest TEXT,
          policy_id TEXT NOT NULL,
          topic TEXT NOT NULL,
          requested_at TEXT NOT NULL,
          requested_at_ms INTEGER NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'settled', 'uncertain')),
          attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 0 AND 100000),
          lease_id TEXT,
          lease_owner TEXT,
          lease_expires_at TEXT,
          lease_expires_at_ms INTEGER,
          summary_json TEXT,
          failure_code TEXT,
          terminal_at TEXT,
          reconciliation_json TEXT,
          PRIMARY KEY (project_id, source_event_id),
          CHECK (
            (origin_conversation_id IS NULL AND origin_thread_id IS NULL
              AND origin_requester_participant_id IS NULL AND origin_binding_digest IS NULL)
            OR
            (origin_conversation_id IS NOT NULL
              AND origin_requester_participant_id IS NOT NULL
              AND origin_binding_digest IS NOT NULL)
          ),
          CHECK (
            (state = 'queued' AND attempt_count = 0 AND lease_id IS NULL
              AND lease_owner IS NULL AND lease_expires_at IS NULL
              AND lease_expires_at_ms IS NULL AND summary_json IS NULL
              AND failure_code IS NULL AND terminal_at IS NULL
              AND reconciliation_json IS NULL)
            OR
            (state = 'leased' AND attempt_count > 0 AND lease_id IS NOT NULL
              AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL
              AND lease_expires_at_ms IS NOT NULL AND summary_json IS NULL
              AND failure_code IS NULL AND terminal_at IS NULL
              AND reconciliation_json IS NULL)
            OR
            (state = 'settled' AND attempt_count > 0 AND lease_id IS NULL
              AND lease_owner IS NULL AND lease_expires_at IS NULL
              AND lease_expires_at_ms IS NULL AND summary_json IS NOT NULL
              AND failure_code IS NULL AND terminal_at IS NOT NULL)
            OR
            (state = 'uncertain' AND attempt_count > 0 AND lease_id IS NULL
              AND lease_owner IS NULL AND lease_expires_at IS NULL
              AND lease_expires_at_ms IS NULL AND summary_json IS NULL
              AND failure_code IS NOT NULL AND terminal_at IS NOT NULL
              AND reconciliation_json IS NULL)
          )
        ) STRICT;
        CREATE INDEX conversation_deliberation_jobs_claim
          ON conversation_deliberation_jobs(state, requested_at_ms, deliberation_id);
        CREATE UNIQUE INDEX conversation_deliberation_jobs_active_lease
          ON conversation_deliberation_jobs(lease_id) WHERE lease_id IS NOT NULL;
        CREATE TRIGGER conversation_deliberation_job_identity_immutable
          BEFORE UPDATE ON conversation_deliberation_jobs
          WHEN OLD.project_id != NEW.project_id
            OR OLD.source_event_id != NEW.source_event_id
            OR OLD.deliberation_id != NEW.deliberation_id
            OR OLD.request_hash != NEW.request_hash
            OR OLD.principal_hash != NEW.principal_hash
            OR OLD.origin_conversation_id IS NOT NEW.origin_conversation_id
            OR OLD.origin_thread_id IS NOT NEW.origin_thread_id
            OR OLD.origin_requester_participant_id IS NOT NEW.origin_requester_participant_id
            OR OLD.origin_binding_digest IS NOT NEW.origin_binding_digest
            OR OLD.policy_id != NEW.policy_id
            OR OLD.topic != NEW.topic
            OR OLD.requested_at != NEW.requested_at
            OR OLD.requested_at_ms != NEW.requested_at_ms
          BEGIN SELECT RAISE(ABORT, 'conversation deliberation job identity is immutable'); END;
        CREATE TRIGGER conversation_deliberation_job_lifecycle
          BEFORE UPDATE ON conversation_deliberation_jobs
          WHEN NOT (
            (OLD.state = 'queued' AND NEW.state = 'leased')
            OR (OLD.state = 'leased' AND NEW.state = 'leased'
              AND OLD.attempt_count = NEW.attempt_count
              AND OLD.lease_id = NEW.lease_id
              AND OLD.lease_owner = NEW.lease_owner
              AND NEW.lease_expires_at_ms > OLD.lease_expires_at_ms
              AND OLD.summary_json IS NEW.summary_json
              AND OLD.failure_code IS NEW.failure_code
              AND OLD.terminal_at IS NEW.terminal_at
              AND OLD.reconciliation_json IS NEW.reconciliation_json)
            OR (OLD.state = 'leased' AND NEW.state IN ('settled', 'uncertain')
              AND OLD.reconciliation_json IS NEW.reconciliation_json)
            OR (OLD.state = 'uncertain' AND NEW.state = 'settled'
              AND OLD.attempt_count = NEW.attempt_count
              AND OLD.lease_id IS NEW.lease_id
              AND OLD.lease_owner IS NEW.lease_owner
              AND OLD.lease_expires_at IS NEW.lease_expires_at
              AND OLD.lease_expires_at_ms IS NEW.lease_expires_at_ms
              AND OLD.summary_json IS NULL AND NEW.summary_json IS NOT NULL
              AND OLD.failure_code IS NOT NULL AND NEW.failure_code IS NULL
              AND OLD.reconciliation_json IS NULL AND NEW.reconciliation_json IS NOT NULL)
          )
          BEGIN SELECT RAISE(ABORT, 'conversation deliberation job lifecycle is invalid'); END;
        CREATE TRIGGER conversation_deliberation_job_no_delete
          BEFORE DELETE ON conversation_deliberation_jobs
          BEGIN SELECT RAISE(ABORT, 'conversation deliberation job cannot be deleted'); END;
      `);
    }
    if (version === 1) {
      database.exec(`
        ALTER TABLE conversation_deliberation_jobs ADD COLUMN reconciliation_json TEXT;
        DROP TRIGGER conversation_deliberation_job_lifecycle;
        CREATE TRIGGER conversation_deliberation_job_lifecycle
          BEFORE UPDATE ON conversation_deliberation_jobs
          WHEN NOT (
            (OLD.state = 'queued' AND NEW.state = 'leased'
              AND OLD.reconciliation_json IS NEW.reconciliation_json)
            OR (OLD.state = 'leased' AND NEW.state = 'leased'
              AND OLD.attempt_count = NEW.attempt_count
              AND OLD.lease_id = NEW.lease_id
              AND OLD.lease_owner = NEW.lease_owner
              AND NEW.lease_expires_at_ms > OLD.lease_expires_at_ms
              AND OLD.summary_json IS NEW.summary_json
              AND OLD.failure_code IS NEW.failure_code
              AND OLD.terminal_at IS NEW.terminal_at
              AND OLD.reconciliation_json IS NEW.reconciliation_json)
            OR (OLD.state = 'leased' AND NEW.state IN ('settled', 'uncertain')
              AND OLD.reconciliation_json IS NEW.reconciliation_json)
            OR (OLD.state = 'uncertain' AND NEW.state = 'settled'
              AND OLD.attempt_count = NEW.attempt_count
              AND OLD.lease_id IS NEW.lease_id
              AND OLD.lease_owner IS NEW.lease_owner
              AND OLD.lease_expires_at IS NEW.lease_expires_at
              AND OLD.lease_expires_at_ms IS NEW.lease_expires_at_ms
              AND OLD.summary_json IS NULL AND NEW.summary_json IS NOT NULL
              AND OLD.failure_code IS NOT NULL AND NEW.failure_code IS NULL
              AND OLD.reconciliation_json IS NULL AND NEW.reconciliation_json IS NOT NULL)
          )
          BEGIN SELECT RAISE(ABORT, 'conversation deliberation job lifecycle is invalid'); END;
        PRAGMA user_version = 2;
      `);
    }
    if (version === 1 || version === 2) {
      database.exec(`
        ALTER TABLE conversation_deliberation_jobs ADD COLUMN origin_conversation_id TEXT;
        ALTER TABLE conversation_deliberation_jobs ADD COLUMN origin_thread_id TEXT;
        ALTER TABLE conversation_deliberation_jobs ADD COLUMN origin_requester_participant_id TEXT;
        ALTER TABLE conversation_deliberation_jobs ADD COLUMN origin_binding_digest TEXT;
        DROP TRIGGER conversation_deliberation_job_identity_immutable;
        CREATE TRIGGER conversation_deliberation_job_identity_immutable
          BEFORE UPDATE ON conversation_deliberation_jobs
          WHEN OLD.project_id != NEW.project_id
            OR OLD.source_event_id != NEW.source_event_id
            OR OLD.deliberation_id != NEW.deliberation_id
            OR OLD.request_hash != NEW.request_hash
            OR OLD.principal_hash != NEW.principal_hash
            OR OLD.origin_conversation_id IS NOT NEW.origin_conversation_id
            OR OLD.origin_thread_id IS NOT NEW.origin_thread_id
            OR OLD.origin_requester_participant_id IS NOT NEW.origin_requester_participant_id
            OR OLD.origin_binding_digest IS NOT NEW.origin_binding_digest
            OR OLD.policy_id != NEW.policy_id
            OR OLD.topic != NEW.topic
            OR OLD.requested_at != NEW.requested_at
            OR OLD.requested_at_ms != NEW.requested_at_ms
          BEGIN SELECT RAISE(ABORT, 'conversation deliberation job identity is immutable'); END;
      `);
    }
    if (version === 0 || version === 1 || version === 2 || version === 3) {
      createConversationDeliberationNotificationSchema(database, "conversation_deliberation_jobs");
      database.exec("PRAGMA user_version = 4;");
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
