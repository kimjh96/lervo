import { beginConversationRepositoryWork } from "./conversation-repository-work-admission.js";
import { migrateConversationRepositoryWorkSessions } from "./conversation-repository-work-session-migration.js";
import { DatabaseSync } from "node:sqlite";

import type { RepositoryWorkProvider } from "@lervo/adapter-contract";

const MAXIMUM_TURNS = 4_096;
const MAXIMUM_SESSIONS = 1_024;

export interface ConversationRepositoryWorkResultReference {
  contentHash: string;
  byteCount: number;
}

export interface ConversationRepositoryWorkDelegate {
  agentId: string;
  displayName: string;
  roleId: string;
  provider: RepositoryWorkProvider | "any";
}

export class SQLiteConversationRepositoryWorkStore {
  private constructor(private readonly database: DatabaseSync) {}

  static open(path: string): SQLiteConversationRepositoryWorkStore {
    const database = new DatabaseSync(path, { allowExtension: false });
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS conversation_repository_work_sessions (
        conversation_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, thread_id, worker_id, provider)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS conversation_repository_work_turns (
        event_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        request_content_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        failure_code TEXT,
        attempt_count INTEGER NOT NULL,
        provider_session_id TEXT,
        result_content_hash TEXT,
        result_byte_count INTEGER,
        started_at_ms INTEGER NOT NULL,
        completed_at_ms INTEGER
      ) STRICT;
      CREATE TABLE IF NOT EXISTS conversation_repository_work_delegates (
        conversation_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        activated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, thread_id)
      ) STRICT;
    `);
    migrateConversationRepositoryWorkSessions(database);
    const turnColumns = database
      .prepare("PRAGMA table_info(conversation_repository_work_turns)")
      .all() as { name: string }[];
    if (!turnColumns.some((column) => column.name === "failure_code")) {
      database.exec("ALTER TABLE conversation_repository_work_turns ADD COLUMN failure_code TEXT");
    }
    return new SQLiteConversationRepositoryWorkStore(database);
  }

  begin(input: Parameters<typeof beginConversationRepositoryWork>[1]) {
    return beginConversationRepositoryWork(this.database, input);
  }

  complete(input: {
    eventId: string;
    conversationId: string;
    threadId: string | null;
    workerId: string;
    provider: RepositoryWorkProvider;
    providerSessionId: string;
    result: ConversationRepositoryWorkResultReference;
    completedAt: string;
  }): void {
    const threadId = input.threadId ?? "";
    const completedAtMs = Date.parse(input.completedAt);
    if (!Number.isFinite(completedAtMs)) {
      throw new Error("The conversation work completion time is invalid.");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO conversation_repository_work_sessions
            (conversation_id, thread_id, worker_id, provider, provider_session_id, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(conversation_id, thread_id, worker_id, provider) DO UPDATE SET
             provider_session_id = excluded.provider_session_id,
             updated_at_ms = excluded.updated_at_ms`,
        )
        .run(
          input.conversationId,
          threadId,
          input.workerId,
          input.provider,
          input.providerSessionId,
          completedAtMs,
        );
      const changed = this.database
        .prepare(
          `UPDATE conversation_repository_work_turns SET
             status = 'completed', failure_code = NULL, provider_session_id = ?, result_content_hash = ?,
             result_byte_count = ?, completed_at_ms = ?
           WHERE event_id = ? AND status = 'running'`,
        )
        .run(
          input.providerSessionId,
          input.result.contentHash,
          input.result.byteCount,
          completedAtMs,
          input.eventId,
        );
      if (changed.changes !== 1) throw new Error("The conversation work turn is not running.");
      this.prune();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  fail(eventId: string, failureCode: string, failedAt: string): void {
    const failedAtMs = Date.parse(failedAt);
    if (!Number.isFinite(failedAtMs) || !/^[a-z][a-z0-9_]{0,63}$/u.test(failureCode)) return;
    this.database
      .prepare(
        `UPDATE conversation_repository_work_turns
         SET status = 'failed', failure_code = ?, completed_at_ms = ?
         WHERE event_id = ? AND status = 'running'`,
      )
      .run(failureCode, failedAtMs, eventId);
  }

  failureCode(eventId: string): string | null {
    const row = this.database
      .prepare("SELECT failure_code FROM conversation_repository_work_turns WHERE event_id = ?")
      .get(eventId) as { failure_code: string | null } | undefined;
    return row?.failure_code ?? null;
  }

  recentCompletedResults(input: {
    conversationId: string;
    threadId: string | null;
    workerId: string;
    limit?: number;
  }): ConversationRepositoryWorkResultReference[] {
    const limit = Math.min(8, Math.max(1, input.limit ?? 4));
    return (
      this.database
        .prepare(
          `SELECT result_content_hash, result_byte_count
           FROM conversation_repository_work_turns
           WHERE conversation_id = ? AND thread_id = ? AND worker_id = ? AND status = 'completed'
             AND result_content_hash IS NOT NULL AND result_byte_count IS NOT NULL
           ORDER BY completed_at_ms DESC LIMIT ?`,
        )
        .all(input.conversationId, input.threadId ?? "", input.workerId, limit) as Array<{
        result_content_hash: string;
        result_byte_count: number;
      }>
    ).map((row) => ({
      contentHash: row.result_content_hash,
      byteCount: row.result_byte_count,
    }));
  }

  activateDelegate(input: {
    conversationId: string;
    threadId: string | null;
    delegate: ConversationRepositoryWorkDelegate;
    activatedAt: string;
  }): void {
    const activatedAtMs = Date.parse(input.activatedAt);
    if (!Number.isFinite(activatedAtMs))
      throw new Error("The delegate activation time is invalid.");
    this.database
      .prepare(
        `INSERT INTO conversation_repository_work_delegates
          (conversation_id, thread_id, agent_id, display_name, role_id, provider, activated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id, thread_id) DO UPDATE SET
           agent_id = excluded.agent_id, display_name = excluded.display_name,
           role_id = excluded.role_id, provider = excluded.provider,
           activated_at_ms = excluded.activated_at_ms`,
      )
      .run(
        input.conversationId,
        input.threadId ?? "",
        input.delegate.agentId,
        input.delegate.displayName,
        input.delegate.roleId,
        input.delegate.provider,
        activatedAtMs,
      );
    this.prune();
  }

  activeDelegate(
    conversationId: string,
    threadId: string | null,
  ): ConversationRepositoryWorkDelegate | null {
    const row = this.database
      .prepare(
        `SELECT agent_id, display_name, role_id, provider
         FROM conversation_repository_work_delegates
         WHERE conversation_id = ? AND thread_id = ?`,
      )
      .get(conversationId, threadId ?? "") as
      | {
          agent_id: string;
          display_name: string;
          role_id: string;
          provider: RepositoryWorkProvider | "any";
        }
      | undefined;
    return row === undefined
      ? null
      : {
          agentId: row.agent_id,
          displayName: row.display_name,
          roleId: row.role_id,
          provider: row.provider,
        };
  }

  sessionProvider(
    conversationId: string,
    threadId: string | null,
    workerId: string,
  ): RepositoryWorkProvider | null {
    const row = this.database
      .prepare(
        `SELECT provider FROM conversation_repository_work_sessions
         WHERE conversation_id = ? AND thread_id = ? AND worker_id = ?
         ORDER BY updated_at_ms DESC LIMIT 1`,
      )
      .get(conversationId, threadId ?? "", workerId) as
      { provider: RepositoryWorkProvider } | undefined;
    return row?.provider ?? null;
  }

  providerForEvent(eventId: string): RepositoryWorkProvider | null {
    const row = this.database
      .prepare("SELECT provider FROM conversation_repository_work_turns WHERE event_id = ?")
      .get(eventId) as { provider: RepositoryWorkProvider } | undefined;
    return row?.provider ?? null;
  }

  close(): void {
    this.database.close();
  }

  private prune(): void {
    this.database
      .prepare(
        `DELETE FROM conversation_repository_work_turns WHERE event_id IN (
           SELECT event_id FROM conversation_repository_work_turns
           WHERE status != 'running' ORDER BY COALESCE(completed_at_ms, started_at_ms) DESC
           LIMIT -1 OFFSET ?
         )`,
      )
      .run(MAXIMUM_TURNS);
    this.database
      .prepare(
        `DELETE FROM conversation_repository_work_sessions WHERE rowid IN (
           SELECT rowid FROM conversation_repository_work_sessions
           ORDER BY updated_at_ms DESC LIMIT -1 OFFSET ?
         )`,
      )
      .run(MAXIMUM_SESSIONS);
    this.database
      .prepare(
        `DELETE FROM conversation_repository_work_delegates WHERE rowid IN (
           SELECT rowid FROM conversation_repository_work_delegates
           ORDER BY activated_at_ms DESC LIMIT -1 OFFSET ?
         )`,
      )
      .run(MAXIMUM_SESSIONS);
  }
}
