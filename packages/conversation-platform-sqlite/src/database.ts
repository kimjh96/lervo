import { chmod, lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { ConversationPlatformSQLiteError } from "./errors.js";

export const conversationPlatformSQLiteSchemaVersion = 2;

export async function ensureConversationPlatformDatabasePath(path: string): Promise<string> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  try {
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new ConversationPlatformSQLiteError(
        "integrity_failed",
        "Conversation platform SQLite 경로는 일반 파일이어야 합니다.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

export async function restrictConversationPlatformDatabase(path: string): Promise<void> {
  await chmod(path, 0o600);
}

export function configureConversationPlatformDatabase(database: DatabaseSync): void {
  const defensive = database as DatabaseSync & { enableDefensive?: (active: boolean) => void };
  defensive.enableDefensive?.(true);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
}

function migrateConversationPlatformVersionOne(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE conversation_bindings_v2 (
      platform TEXT NOT NULL CHECK (
        length(platform) BETWEEN 1 AND 64 AND platform GLOB '[a-z]*'
        AND platform NOT GLOB '*[^a-z0-9_-]*'
      ),
      integration_id TEXT NOT NULL,
      tenant_key TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      PRIMARY KEY (platform, integration_id, tenant_key, conversation_key),
      UNIQUE (platform, integration_id, project_id, conversation_id)
    ) STRICT;
    CREATE TABLE participant_bindings_v2 (
      platform TEXT NOT NULL CHECK (
        length(platform) BETWEEN 1 AND 64 AND platform GLOB '[a-z]*'
        AND platform NOT GLOB '*[^a-z0-9_-]*'
      ),
      integration_id TEXT NOT NULL,
      tenant_key TEXT NOT NULL,
      participant_key TEXT NOT NULL,
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent', 'system')),
      participant_id TEXT NOT NULL,
      role_id TEXT,
      PRIMARY KEY (platform, integration_id, tenant_key, participant_key),
      CHECK ((actor_kind = 'agent' AND role_id IS NOT NULL)
        OR (actor_kind != 'agent' AND role_id IS NULL))
    ) STRICT;
    CREATE TABLE thread_bindings_v2 (
      platform TEXT NOT NULL CHECK (
        length(platform) BETWEEN 1 AND 64 AND platform GLOB '[a-z]*'
        AND platform NOT GLOB '*[^a-z0-9_-]*'
      ),
      integration_id TEXT NOT NULL,
      tenant_key TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      thread_key TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      PRIMARY KEY (platform, integration_id, tenant_key, conversation_key, thread_key),
      UNIQUE (platform, integration_id, thread_id),
      FOREIGN KEY (platform, integration_id, tenant_key, conversation_key)
        REFERENCES conversation_bindings_v2(platform, integration_id, tenant_key, conversation_key)
    ) STRICT;
    CREATE TABLE message_correlations_v2 (
      platform TEXT NOT NULL CHECK (
        length(platform) BETWEEN 1 AND 64 AND platform GLOB '[a-z]*'
        AND platform NOT GLOB '*[^a-z0-9_-]*'
      ),
      integration_id TEXT NOT NULL,
      tenant_key TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      external_message_key TEXT NOT NULL,
      reply_event_id TEXT NOT NULL,
      observed_event_id TEXT,
      outbound_id TEXT UNIQUE,
      automation_depth INTEGER NOT NULL CHECK (automation_depth BETWEEN 0 AND 8),
      PRIMARY KEY (platform, integration_id, tenant_key, conversation_key, external_message_key),
      FOREIGN KEY (platform, integration_id, tenant_key, conversation_key)
        REFERENCES conversation_bindings_v2(platform, integration_id, tenant_key, conversation_key)
    ) STRICT;
    CREATE TABLE delivery_replay_v2 (
      platform TEXT NOT NULL CHECK (
        length(platform) BETWEEN 1 AND 64 AND platform GLOB '[a-z]*'
        AND platform NOT GLOB '*[^a-z0-9_-]*'
      ),
      integration_id TEXT NOT NULL,
      outbound_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('sending', 'unknown', 'rejected', 'delivered')),
      attempted_at TEXT NOT NULL,
      external_message_key TEXT,
      delivered_at TEXT,
      PRIMARY KEY (platform, integration_id, outbound_id),
      CHECK ((status = 'delivered' AND external_message_key IS NOT NULL AND delivered_at IS NOT NULL)
        OR (status != 'delivered' AND external_message_key IS NULL AND delivered_at IS NULL))
    ) STRICT;

    INSERT INTO conversation_bindings_v2 SELECT * FROM conversation_bindings;
    INSERT INTO participant_bindings_v2 SELECT * FROM participant_bindings;
    INSERT INTO thread_bindings_v2 SELECT * FROM thread_bindings;
    INSERT INTO message_correlations_v2 SELECT * FROM message_correlations;
    INSERT INTO delivery_replay_v2 SELECT * FROM delivery_replay;

    DROP TABLE message_correlations;
    DROP TABLE thread_bindings;
    DROP TABLE participant_bindings;
    DROP TABLE delivery_replay;
    DROP TABLE conversation_bindings;
    ALTER TABLE conversation_bindings_v2 RENAME TO conversation_bindings;
    ALTER TABLE participant_bindings_v2 RENAME TO participant_bindings;
    ALTER TABLE thread_bindings_v2 RENAME TO thread_bindings;
    ALTER TABLE message_correlations_v2 RENAME TO message_correlations;
    ALTER TABLE delivery_replay_v2 RENAME TO delivery_replay;
    CREATE TRIGGER delivery_replay_identity_immutable
      BEFORE UPDATE ON delivery_replay
      WHEN OLD.platform != NEW.platform OR OLD.integration_id != NEW.integration_id
        OR OLD.outbound_id != NEW.outbound_id OR OLD.request_hash != NEW.request_hash
        OR OLD.status = 'delivered'
      BEGIN SELECT RAISE(ABORT, 'delivery replay identity is immutable'); END;
    PRAGMA user_version = 2;
  `);
}

export function migrateConversationPlatformDatabase(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const version = database.prepare("PRAGMA user_version;").get()?.user_version;
    if (version !== 0 && version !== 1 && version !== conversationPlatformSQLiteSchemaVersion) {
      throw new ConversationPlatformSQLiteError(
        "integrity_failed",
        "지원하지 않는 Conversation platform SQLite schema입니다.",
      );
    }
    if (version === 0) {
      database.exec(`
        CREATE TABLE conversation_bindings (
          platform TEXT NOT NULL CHECK (
            length(platform) BETWEEN 1 AND 64 AND platform GLOB '[a-z]*'
            AND platform NOT GLOB '*[^a-z0-9_-]*'
          ),
          integration_id TEXT NOT NULL,
          tenant_key TEXT NOT NULL,
          conversation_key TEXT NOT NULL,
          project_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          PRIMARY KEY (platform, integration_id, tenant_key, conversation_key),
          UNIQUE (platform, integration_id, project_id, conversation_id)
        ) STRICT;
        CREATE TABLE participant_bindings (
          platform TEXT NOT NULL CHECK (
            length(platform) BETWEEN 1 AND 64 AND platform GLOB '[a-z]*'
            AND platform NOT GLOB '*[^a-z0-9_-]*'
          ),
          integration_id TEXT NOT NULL,
          tenant_key TEXT NOT NULL,
          participant_key TEXT NOT NULL,
          actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent', 'system')),
          participant_id TEXT NOT NULL,
          role_id TEXT,
          PRIMARY KEY (platform, integration_id, tenant_key, participant_key),
          CHECK ((actor_kind = 'agent' AND role_id IS NOT NULL)
            OR (actor_kind != 'agent' AND role_id IS NULL))
        ) STRICT;
        CREATE TABLE thread_bindings (
          platform TEXT NOT NULL,
          integration_id TEXT NOT NULL,
          tenant_key TEXT NOT NULL,
          conversation_key TEXT NOT NULL,
          thread_key TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          PRIMARY KEY (platform, integration_id, tenant_key, conversation_key, thread_key),
          UNIQUE (platform, integration_id, thread_id),
          FOREIGN KEY (platform, integration_id, tenant_key, conversation_key)
            REFERENCES conversation_bindings(platform, integration_id, tenant_key, conversation_key)
        ) STRICT;
        CREATE TABLE message_correlations (
          platform TEXT NOT NULL,
          integration_id TEXT NOT NULL,
          tenant_key TEXT NOT NULL,
          conversation_key TEXT NOT NULL,
          external_message_key TEXT NOT NULL,
          reply_event_id TEXT NOT NULL,
          observed_event_id TEXT,
          outbound_id TEXT UNIQUE,
          automation_depth INTEGER NOT NULL CHECK (automation_depth BETWEEN 0 AND 8),
          PRIMARY KEY (
            platform, integration_id, tenant_key, conversation_key, external_message_key
          ),
          FOREIGN KEY (platform, integration_id, tenant_key, conversation_key)
            REFERENCES conversation_bindings(platform, integration_id, tenant_key, conversation_key)
        ) STRICT;
        CREATE TABLE delivery_replay (
          platform TEXT NOT NULL CHECK (
            length(platform) BETWEEN 1 AND 64 AND platform GLOB '[a-z]*'
            AND platform NOT GLOB '*[^a-z0-9_-]*'
          ),
          integration_id TEXT NOT NULL,
          outbound_id TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('sending', 'unknown', 'rejected', 'delivered')),
          attempted_at TEXT NOT NULL,
          external_message_key TEXT,
          delivered_at TEXT,
          PRIMARY KEY (platform, integration_id, outbound_id),
          CHECK ((status = 'delivered' AND external_message_key IS NOT NULL AND delivered_at IS NOT NULL)
            OR (status != 'delivered' AND external_message_key IS NULL AND delivered_at IS NULL))
        ) STRICT;
        CREATE TRIGGER delivery_replay_identity_immutable
          BEFORE UPDATE ON delivery_replay
          WHEN OLD.platform != NEW.platform OR OLD.integration_id != NEW.integration_id
            OR OLD.outbound_id != NEW.outbound_id OR OLD.request_hash != NEW.request_hash
            OR OLD.status = 'delivered'
          BEGIN SELECT RAISE(ABORT, 'delivery replay identity is immutable'); END;
        PRAGMA user_version = 2;
      `);
    }
    if (version === 1) migrateConversationPlatformVersionOne(database);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function assertConversationPlatformDatabaseIntegrity(database: DatabaseSync): void {
  const quick = database.prepare("PRAGMA quick_check;").get()?.quick_check;
  const foreignKeyViolation = database.prepare("PRAGMA foreign_key_check;").get();
  if (quick !== "ok" || foreignKeyViolation !== undefined) {
    throw new ConversationPlatformSQLiteError(
      "integrity_failed",
      "Conversation platform SQLite 무결성 검사가 실패했습니다.",
    );
  }
}
