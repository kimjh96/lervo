import type { DatabaseSync } from "node:sqlite";

function outboxTable(table: "conversation_outbox" | "conversation_outbox_v2"): string {
  return `
    CREATE TABLE ${table} (
      outbound_id TEXT PRIMARY KEY,
      source_event_id TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      outbound_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'delivered', 'attention_required')),
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
        OR
        (status = 'attention_required' AND lease_id IS NULL AND lease_owner IS NULL
          AND lease_expires_at_ms IS NULL AND receipt_json IS NULL
          AND delivered_at_ms IS NULL AND last_failure_code IS NOT NULL
          AND last_failed_at_ms IS NOT NULL)
      ),
      CHECK (
        (last_failure_code IS NULL AND last_failed_at_ms IS NULL)
        OR (last_failure_code IS NOT NULL AND last_failed_at_ms IS NOT NULL)
      )
    ) STRICT;
  `;
}

const outboxIndexAndTriggers = `
  CREATE INDEX conversation_outbox_ready
    ON conversation_outbox (integration_id, status, available_at_ms, outbound_id);
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
      OR (OLD.status = 'leased'
        AND NEW.status IN ('pending', 'leased', 'delivered', 'attention_required'))
      OR (OLD.status = 'attention_required' AND NEW.status = 'delivered')
    )
    BEGIN SELECT RAISE(ABORT, 'conversation outbox lifecycle is invalid'); END;
  CREATE TRIGGER conversation_outbox_no_delete BEFORE DELETE ON conversation_outbox
    BEGIN SELECT RAISE(ABORT, 'conversation outbox cannot be deleted'); END;
`;

export function createConversationOutboxSchema(): string {
  return `${outboxTable("conversation_outbox")} ${outboxIndexAndTriggers}`;
}

export function migrateConversationOutboxAttentionState(database: DatabaseSync): void {
  database.exec(`
    DROP TRIGGER conversation_outbox_identity_immutable;
    DROP TRIGGER conversation_outbox_lifecycle_guard;
    DROP TRIGGER conversation_outbox_no_delete;
    ${outboxTable("conversation_outbox_v2")}
    INSERT INTO conversation_outbox_v2 SELECT * FROM conversation_outbox;
    DROP TABLE conversation_outbox;
    ALTER TABLE conversation_outbox_v2 RENAME TO conversation_outbox;
    ${outboxIndexAndTriggers}
    UPDATE interaction_meta SET value = '2' WHERE key = 'storage_schema_version';
    PRAGMA user_version = 2;
  `);
}
