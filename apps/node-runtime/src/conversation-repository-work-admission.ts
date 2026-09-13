import type { DatabaseSync } from "node:sqlite";
import type { RepositoryWorkProvider } from "@lervo/adapter-contract";

const SEMANTIC_DUPLICATE_WINDOW_MS = 5 * 60 * 1_000;

interface WorkTurnRow {
  conversation_id: string;
  thread_id: string;
  worker_id: string;
  provider: RepositoryWorkProvider;
  request_content_hash: string;
  status: "running" | "completed" | "failed";
  failure_code: string | null;
  provider_session_id: string | null;
  result_content_hash: string | null;
  result_byte_count: number | null;
}

export function beginConversationRepositoryWork(
  database: DatabaseSync,
  input: {
    eventId: string;
    conversationId: string;
    threadId: string | null;
    workerId: string;
    provider: RepositoryWorkProvider;
    requestContentHash: string;
    startedAt: string;
  },
): {
  providerSessionId: string | null;
  completed: { contentHash: string; byteCount: number } | null;
  duplicate: "in_progress" | "completed" | null;
} {
  database.exec("BEGIN IMMEDIATE");
  try {
    const threadId = input.threadId ?? "";
    const current = database
      .prepare(
        `SELECT conversation_id, thread_id, worker_id, provider, request_content_hash, status,
                failure_code,
                provider_session_id, result_content_hash, result_byte_count
         FROM conversation_repository_work_turns WHERE event_id = ?`,
      )
      .get(input.eventId) as WorkTurnRow | undefined;
    if (
      current !== undefined &&
      (current.conversation_id !== input.conversationId ||
        current.thread_id !== threadId ||
        current.worker_id !== input.workerId ||
        current.provider !== input.provider ||
        current.request_content_hash !== input.requestContentHash)
    ) {
      throw new Error("The conversation work event differs from its durable coordinates.");
    }
    if (current?.status === "completed") {
      if (current.result_content_hash === null || current.result_byte_count === null) {
        throw new Error("The completed conversation work turn has no result reference.");
      }
      database.exec("COMMIT");
      return {
        providerSessionId: current.provider_session_id,
        completed: {
          contentHash: current.result_content_hash,
          byteCount: current.result_byte_count,
        },
        duplicate: null,
      };
    }
    if (current?.status === "running") {
      database.exec("COMMIT");
      return {
        providerSessionId: current.provider_session_id,
        completed: null,
        duplicate: "in_progress",
      };
    }
    const session = database
      .prepare(
        `SELECT provider, provider_session_id FROM conversation_repository_work_sessions
         WHERE conversation_id = ? AND thread_id = ? AND worker_id = ?`,
      )
      .get(input.conversationId, threadId, input.workerId) as
      { provider: RepositoryWorkProvider; provider_session_id: string } | undefined;
    if (session !== undefined && session.provider !== input.provider) {
      throw new Error("The conversation work provider differs from its durable session.");
    }
    const startedAtMs = Date.parse(input.startedAt);
    if (!Number.isFinite(startedAtMs))
      throw new Error("The conversation work start time is invalid.");
    const duplicate = database
      .prepare(
        `SELECT status, provider_session_id, result_content_hash, result_byte_count
           FROM conversation_repository_work_turns
           WHERE event_id != ? AND conversation_id = ? AND thread_id = ? AND worker_id = ?
             AND provider = ? AND request_content_hash = ?
             AND (status = 'running' OR COALESCE(completed_at_ms, started_at_ms) >= ?)
           ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END,
             COALESCE(completed_at_ms, started_at_ms) DESC
           LIMIT 1`,
      )
      .get(
        input.eventId,
        input.conversationId,
        threadId,
        input.workerId,
        input.provider,
        input.requestContentHash,
        startedAtMs - SEMANTIC_DUPLICATE_WINDOW_MS,
      ) as
      | {
          status: "running" | "completed" | "failed";
          provider_session_id: string | null;
          result_content_hash: string | null;
          result_byte_count: number | null;
        }
      | undefined;
    if (duplicate?.status === "running") {
      database.exec("COMMIT");
      return {
        providerSessionId: duplicate.provider_session_id,
        completed: null,
        duplicate: "in_progress",
      };
    }
    if (
      duplicate?.status === "completed" &&
      duplicate.result_content_hash !== null &&
      duplicate.result_byte_count !== null
    ) {
      database.exec("COMMIT");
      return {
        providerSessionId: duplicate.provider_session_id,
        completed: {
          contentHash: duplicate.result_content_hash,
          byteCount: duplicate.result_byte_count,
        },
        duplicate: "completed",
      };
    }
    database
      .prepare(
        `INSERT INTO conversation_repository_work_turns
          (event_id, conversation_id, thread_id, worker_id, provider, request_content_hash, status,
           failure_code,
           attempt_count, provider_session_id, result_content_hash, result_byte_count,
           started_at_ms, completed_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, 'running', NULL, 1, ?, NULL, NULL, ?, NULL)
         ON CONFLICT(event_id) DO UPDATE SET
           status = 'running', attempt_count = attempt_count + 1, started_at_ms = excluded.started_at_ms,
           failure_code = NULL, completed_at_ms = NULL`,
      )
      .run(
        input.eventId,
        input.conversationId,
        threadId,
        input.workerId,
        input.provider,
        input.requestContentHash,
        session?.provider_session_id ?? null,
        startedAtMs,
      );
    database.exec("COMMIT");
    return {
      providerSessionId: session?.provider_session_id ?? null,
      completed: null,
      duplicate: null,
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
