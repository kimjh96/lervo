import type { DatabaseSync } from "node:sqlite";

export const conversationDeliberationNotificationSchemaNames = [
  "conversation_deliberation_notifications_claim",
  "conversation_deliberation_notifications_active_lease",
  "conversation_deliberation_notification_identity_immutable",
  "conversation_deliberation_notification_lifecycle",
  "conversation_deliberation_notification_no_delete",
] as const;

export function createConversationDeliberationNotificationSchema(
  database: DatabaseSync,
  sourceTable: "conversation_deliberation_jobs" | "conversation_deliberation_resume_jobs",
): void {
  database.exec(`
    CREATE TABLE conversation_deliberation_notifications (
      project_id TEXT NOT NULL,
      deliberation_id TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms >= 0),
      state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'accepted')),
      attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 0 AND 100000),
      lease_id TEXT,
      lease_owner TEXT,
      lease_expires_at TEXT,
      lease_expires_at_ms INTEGER,
      conversation_event_id TEXT,
      accepted_at TEXT,
      accepted_at_ms INTEGER,
      PRIMARY KEY (project_id, deliberation_id),
      CHECK (
        (state = 'pending' AND attempt_count = 0 AND lease_id IS NULL
          AND lease_owner IS NULL AND lease_expires_at IS NULL
          AND lease_expires_at_ms IS NULL AND conversation_event_id IS NULL
          AND accepted_at IS NULL AND accepted_at_ms IS NULL)
        OR
        (state = 'leased' AND attempt_count > 0 AND lease_id IS NOT NULL
          AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL
          AND lease_expires_at_ms IS NOT NULL AND conversation_event_id IS NULL
          AND accepted_at IS NULL AND accepted_at_ms IS NULL)
        OR
        (state = 'accepted' AND attempt_count > 0 AND lease_id IS NULL
          AND lease_owner IS NULL AND lease_expires_at IS NULL
          AND lease_expires_at_ms IS NULL AND conversation_event_id IS NOT NULL
          AND accepted_at IS NOT NULL AND accepted_at_ms IS NOT NULL)
      )
    ) STRICT;
    CREATE INDEX conversation_deliberation_notifications_claim
      ON conversation_deliberation_notifications(state, occurred_at_ms, deliberation_id);
    CREATE UNIQUE INDEX conversation_deliberation_notifications_active_lease
      ON conversation_deliberation_notifications(lease_id) WHERE lease_id IS NOT NULL;
    CREATE TRIGGER conversation_deliberation_notification_identity_immutable
      BEFORE UPDATE ON conversation_deliberation_notifications
      WHEN OLD.project_id != NEW.project_id
        OR OLD.deliberation_id != NEW.deliberation_id
        OR OLD.summary_json != NEW.summary_json
        OR OLD.occurred_at != NEW.occurred_at
        OR OLD.occurred_at_ms != NEW.occurred_at_ms
      BEGIN SELECT RAISE(ABORT, 'conversation deliberation notification identity is immutable'); END;
    CREATE TRIGGER conversation_deliberation_notification_lifecycle
      BEFORE UPDATE ON conversation_deliberation_notifications
      WHEN NOT (
        (OLD.state = 'pending' AND NEW.state = 'leased')
        OR (OLD.state = 'leased' AND NEW.state = 'leased'
          AND NEW.attempt_count = OLD.attempt_count + 1
          AND NEW.lease_expires_at_ms > OLD.lease_expires_at_ms)
        OR (OLD.state = 'leased' AND NEW.state = 'accepted'
          AND NEW.attempt_count = OLD.attempt_count
          AND NEW.conversation_event_id IS NOT NULL
          AND NEW.accepted_at_ms >= OLD.occurred_at_ms)
      )
      BEGIN SELECT RAISE(ABORT, 'conversation deliberation notification lifecycle is invalid'); END;
    CREATE TRIGGER conversation_deliberation_notification_no_delete
      BEFORE DELETE ON conversation_deliberation_notifications
      BEGIN SELECT RAISE(ABORT, 'conversation deliberation notification cannot be deleted'); END;

    INSERT INTO conversation_deliberation_notifications (
      project_id, deliberation_id, summary_json, occurred_at, occurred_at_ms,
      state, attempt_count, lease_id, lease_owner, lease_expires_at,
      lease_expires_at_ms, conversation_event_id, accepted_at, accepted_at_ms
    )
    SELECT project_id, deliberation_id, summary_json, terminal_at,
      CAST(strftime('%s', terminal_at) AS INTEGER) * 1000
        + CAST(substr(terminal_at, 21, 3) AS INTEGER),
      'pending', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM ${sourceTable}
    WHERE state = 'settled';
  `);
}

export function insertConversationDeliberationNotificationSql(
  sourceTable: "conversation_deliberation_jobs" | "conversation_deliberation_resume_jobs",
): string {
  return `
    INSERT INTO conversation_deliberation_notifications (
      project_id, deliberation_id, summary_json, occurred_at, occurred_at_ms,
      state, attempt_count, lease_id, lease_owner, lease_expires_at,
      lease_expires_at_ms, conversation_event_id, accepted_at, accepted_at_ms
    )
    SELECT project_id, deliberation_id, summary_json, terminal_at, ?,
      'pending', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM ${sourceTable}
    WHERE deliberation_id = ? AND state = 'settled'
  `;
}
