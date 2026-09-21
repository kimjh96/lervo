import type { DatabaseSync } from "node:sqlite";

/** Upgrades the historical single-provider slot without discarding an existing provider session. */
export function migrateConversationRepositoryWorkSessions(database: DatabaseSync): void {
  const primaryKey = (
    database.prepare("PRAGMA table_info(conversation_repository_work_sessions)").all() as Array<{
      name: string;
      pk: number;
    }>
  )
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
  const legacy = ["conversation_id", "thread_id", "worker_id"];
  const current = [...legacy, "provider"];
  if (primaryKey.join(",") === current.join(",")) return;
  if (primaryKey.join(",") !== legacy.join(",")) {
    throw new Error("The repository work session schema is unknown.");
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE conversation_repository_work_sessions_next (
        conversation_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, thread_id, worker_id, provider)
      ) STRICT;
      INSERT INTO conversation_repository_work_sessions_next
        (conversation_id, thread_id, worker_id, provider, provider_session_id, updated_at_ms)
      SELECT conversation_id, thread_id, worker_id, provider, provider_session_id, updated_at_ms
      FROM conversation_repository_work_sessions;
      DROP TABLE conversation_repository_work_sessions;
      ALTER TABLE conversation_repository_work_sessions_next
        RENAME TO conversation_repository_work_sessions;
    `);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
