import type { DatabaseSync } from "node:sqlite";

import { ConversationDeliberationSQLiteError } from "./errors.js";

export const conversationDeliberationResumeSQLiteSchemaVersion = 1;

export function migrateConversationDeliberationResumeDatabase(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const version = database.prepare("PRAGMA user_version;").get()?.user_version;
    if (version !== 0 && version !== conversationDeliberationResumeSQLiteSchemaVersion) {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "지원하지 않는 Conversation 숙의 재개 queue schema입니다.",
      );
    }
    if (version === 0) {
      database.exec(`
        CREATE TABLE conversation_deliberation_resume_jobs (
          project_id TEXT NOT NULL,
          source_event_id TEXT NOT NULL,
          deliberation_id TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          principal_hash TEXT NOT NULL,
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
          UNIQUE (project_id, deliberation_id),
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
        CREATE INDEX conversation_deliberation_resume_jobs_claim
          ON conversation_deliberation_resume_jobs(state, requested_at_ms, deliberation_id);
        CREATE UNIQUE INDEX conversation_deliberation_resume_jobs_active_lease
          ON conversation_deliberation_resume_jobs(lease_id) WHERE lease_id IS NOT NULL;
        CREATE TRIGGER conversation_deliberation_resume_job_identity_immutable
          BEFORE UPDATE ON conversation_deliberation_resume_jobs
          WHEN OLD.project_id != NEW.project_id
            OR OLD.source_event_id != NEW.source_event_id
            OR OLD.deliberation_id != NEW.deliberation_id
            OR OLD.request_hash != NEW.request_hash
            OR OLD.principal_hash != NEW.principal_hash
            OR OLD.requested_at != NEW.requested_at
            OR OLD.requested_at_ms != NEW.requested_at_ms
          BEGIN SELECT RAISE(ABORT, 'conversation deliberation resume identity is immutable'); END;
        CREATE TRIGGER conversation_deliberation_resume_job_lifecycle
          BEFORE UPDATE ON conversation_deliberation_resume_jobs
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
          BEGIN SELECT RAISE(ABORT, 'conversation deliberation resume lifecycle is invalid'); END;
        CREATE TRIGGER conversation_deliberation_resume_job_no_delete
          BEFORE DELETE ON conversation_deliberation_resume_jobs
          BEGIN SELECT RAISE(ABORT, 'conversation deliberation resume cannot be deleted'); END;
        PRAGMA user_version = 1;
      `);
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
