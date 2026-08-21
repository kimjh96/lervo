import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  type ConversationDeliberationJobStore,
} from "@lervo/conversation-control";

import {
  configureConversationDeliberationDatabase,
  migrateConversationDeliberationDatabase,
  prepareConversationDeliberationDatabasePath,
  restrictConversationDeliberationDatabase,
} from "./database.js";
import { ConversationDeliberationSQLiteError } from "./errors.js";
import {
  assertConversationDeliberationLookup,
  conversationDeliberationMilliseconds,
  decodeConversationDeliberationJob,
  decodeConversationDeliberationSummary,
} from "./row-codec.js";
import { reconcileConversationDeliberationJob } from "./reconciliation.js";

export class SQLiteConversationDeliberationJobStore implements ConversationDeliberationJobStore {
  readonly path: string;
  private closed = false;

  private constructor(
    path: string,
    private readonly database: DatabaseSync,
    private readonly maxRecords: number,
  ) {
    this.path = path;
  }

  static async open(options: {
    path: string;
    maxRecords?: number;
  }): Promise<SQLiteConversationDeliberationJobStore> {
    const maxRecords = options.maxRecords ?? 10_000;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 100_000) {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "Conversation 숙의 queue maxRecords가 유효하지 않습니다.",
      );
    }
    const path = await prepareConversationDeliberationDatabasePath(options.path);
    const database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      await restrictConversationDeliberationDatabase(path);
      configureConversationDeliberationDatabase(database);
      migrateConversationDeliberationDatabase(database);
      const store = new SQLiteConversationDeliberationJobStore(path, database, maxRecords);
      store.checkIntegrity();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async enqueue(input: Parameters<ConversationDeliberationJobStore["enqueue"]>[0]) {
    this.assertOpen();
    const requestedAtMs = conversationDeliberationMilliseconds(input.requestedAt, "숙의 요청");
    const candidate = decodeConversationDeliberationJob({
      project_id: input.projectId,
      source_event_id: input.sourceEventId,
      deliberation_id: input.deliberationId,
      request_hash: input.requestHash,
      principal_hash: input.principalHash,
      policy_id: input.policyId,
      topic: input.topic,
      requested_at: input.requestedAt,
      requested_at_ms: requestedAtMs,
      state: "queued",
      attempt_count: 0,
      lease_id: null,
      lease_owner: null,
      lease_expires_at: null,
      lease_expires_at_ms: null,
      summary_json: null,
      failure_code: null,
      terminal_at: null,
      reconciliation_json: null,
    });
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.database.prepare(`
        SELECT * FROM conversation_deliberation_jobs
        WHERE project_id = ? AND source_event_id = ?
      `).get(input.projectId, input.sourceEventId);
      if (row !== undefined) {
        const existing = decodeConversationDeliberationJob(row);
        if (
          existing.requestHash !== input.requestHash ||
          existing.deliberationId !== input.deliberationId
        ) {
          throw new ConversationDeliberationSQLiteError(
            "deliberation_request_conflict",
            "같은 Conversation event가 다른 숙의 요청에 사용되었습니다.",
          );
        }
        this.database.exec("COMMIT;");
        return existing;
      }
      const count = this.database.prepare(
        "SELECT COUNT(*) AS count FROM conversation_deliberation_jobs",
      ).get()?.count;
      if (typeof count !== "number" || !Number.isSafeInteger(count)) {
        throw new ConversationDeliberationSQLiteError(
          "integrity_failed",
          "Conversation 숙의 queue count가 유효하지 않습니다.",
        );
      }
      if (count >= this.maxRecords) {
        throw new ConversationDeliberationSQLiteError(
          "capacity_exceeded",
          "Conversation 숙의 queue capacity를 초과했습니다.",
        );
      }
      this.database.prepare(`
        INSERT INTO conversation_deliberation_jobs (
          project_id, source_event_id, deliberation_id, request_hash, principal_hash,
          policy_id, topic, requested_at, requested_at_ms, state, attempt_count,
          lease_id, lease_owner, lease_expires_at, lease_expires_at_ms,
          summary_json, failure_code, terminal_at, reconciliation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0,
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
      `).run(
        candidate.projectId,
        candidate.sourceEventId,
        candidate.deliberationId,
        candidate.requestHash,
        candidate.principalHash,
        candidate.policyId,
        candidate.topic,
        candidate.requestedAt,
        requestedAtMs,
      );
      this.database.exec("COMMIT;");
      return candidate;
    } catch (error) {
      this.rollback(error);
    }
  }

  async inspect(input: Parameters<ConversationDeliberationJobStore["inspect"]>[0]) {
    this.assertOpen();
    assertConversationDeliberationLookup(input);
    const row = this.database.prepare(`
      SELECT * FROM conversation_deliberation_jobs
      WHERE project_id = ? AND deliberation_id = ?
    `).get(input.projectId, input.deliberationId);
    return row === undefined ? null : decodeConversationDeliberationJob(row);
  }

  async claim(input: Parameters<ConversationDeliberationJobStore["claim"]>[0]) {
    this.assertOpen();
    const claimedAtMs = conversationDeliberationMilliseconds(input.claimedAt, "숙의 claim");
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(input.workerId) ||
      !Number.isSafeInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 10_000 || input.leaseDurationMs > 60 * 60_000
    ) {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "Conversation 숙의 queue lease 설정이 유효하지 않습니다.",
      );
    }
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database.prepare(`
        UPDATE conversation_deliberation_jobs SET
          state = 'uncertain', lease_id = NULL, lease_owner = NULL,
          lease_expires_at = NULL, lease_expires_at_ms = NULL,
          failure_code = 'worker_lease_expired', terminal_at = ?
        WHERE state = 'leased' AND lease_expires_at_ms <= ?
      `).run(input.claimedAt, claimedAtMs);
      const row = this.database.prepare(`
        SELECT * FROM conversation_deliberation_jobs
        WHERE state = 'queued' AND requested_at_ms <= ?
        ORDER BY requested_at_ms ASC, deliberation_id ASC LIMIT 1
      `).get(claimedAtMs);
      if (row === undefined) {
        this.database.exec("COMMIT;");
        return null;
      }
      const job = decodeConversationDeliberationJob(row);
      const leaseId = `cdl_${randomBytes(24).toString("base64url")}`;
      const leaseExpiresAt = new Date(claimedAtMs + input.leaseDurationMs).toISOString();
      const updated = this.database.prepare(`
        UPDATE conversation_deliberation_jobs SET
          state = 'leased', attempt_count = attempt_count + 1,
          lease_id = ?, lease_owner = ?, lease_expires_at = ?, lease_expires_at_ms = ?
        WHERE project_id = ? AND source_event_id = ? AND state = 'queued'
      `).run(
        leaseId,
        input.workerId,
        leaseExpiresAt,
        claimedAtMs + input.leaseDurationMs,
        job.projectId,
        job.sourceEventId,
      );
      if (updated.changes !== 1) {
        throw new ConversationDeliberationSQLiteError(
          "lease_mismatch",
          "Conversation 숙의 queue lease를 획득하지 못했습니다.",
        );
      }
      const leased = this.database.prepare(`
        SELECT * FROM conversation_deliberation_jobs WHERE deliberation_id = ?
      `).get(job.deliberationId);
      this.database.exec("COMMIT;");
      return { leaseId, job: decodeConversationDeliberationJob(leased!) };
    } catch (error) {
      this.rollback(error);
    }
  }

  async renew(input: Parameters<ConversationDeliberationJobStore["renew"]>[0]) {
    this.assertOpen();
    const renewedAtMs = conversationDeliberationMilliseconds(input.renewedAt, "숙의 lease 갱신");
    if (
      !Number.isSafeInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 10_000 || input.leaseDurationMs > 60 * 60_000
    ) {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "Conversation 숙의 queue 갱신 lease 설정이 유효하지 않습니다.",
      );
    }
    const expiresAtMs = renewedAtMs + input.leaseDurationMs;
    try {
      const result = this.database.prepare(`
        UPDATE conversation_deliberation_jobs SET
          lease_expires_at = ?, lease_expires_at_ms = ?
        WHERE deliberation_id = ? AND state = 'leased' AND lease_id = ?
          AND lease_expires_at_ms > ?
      `).run(
        new Date(expiresAtMs).toISOString(),
        expiresAtMs,
        input.deliberationId,
        input.leaseId,
        renewedAtMs,
      );
      if (result.changes !== 1) {
        throw new ConversationDeliberationSQLiteError(
          "lease_mismatch",
          "Conversation 숙의 queue lease를 갱신하지 못했습니다.",
        );
      }
    } catch (error) {
      this.writeError(error, "Conversation 숙의 queue lease 갱신을 저장하지 못했습니다.");
    }
  }

  async settle(input: Parameters<ConversationDeliberationJobStore["settle"]>[0]) {
    this.assertOpen();
    const settledAtMs = conversationDeliberationMilliseconds(input.settledAt, "숙의 종료");
    const encoded = JSON.stringify(input.summary);
    decodeConversationDeliberationSummary(encoded, input.deliberationId);
    try {
      const result = this.database.prepare(`
        UPDATE conversation_deliberation_jobs SET
          state = 'settled', lease_id = NULL, lease_owner = NULL,
          lease_expires_at = NULL, lease_expires_at_ms = NULL,
          summary_json = ?, terminal_at = ?
        WHERE deliberation_id = ? AND state = 'leased' AND lease_id = ?
          AND requested_at_ms <= ?
      `).run(encoded, input.settledAt, input.deliberationId, input.leaseId, settledAtMs);
      if (result.changes !== 1) {
        throw new ConversationDeliberationSQLiteError(
          "lease_mismatch",
          "Conversation 숙의 queue 종료 lease가 다릅니다.",
        );
      }
    } catch (error) {
      this.writeError(error, "Conversation 숙의 queue 종료 결과를 저장하지 못했습니다.");
    }
  }

  async markUncertain(input: Parameters<ConversationDeliberationJobStore["markUncertain"]>[0]) {
    this.assertOpen();
    const failedAtMs = conversationDeliberationMilliseconds(input.failedAt, "숙의 실패");
    try {
      const result = this.database.prepare(`
        UPDATE conversation_deliberation_jobs SET
          state = 'uncertain', lease_id = NULL, lease_owner = NULL,
          lease_expires_at = NULL, lease_expires_at_ms = NULL,
          failure_code = ?, terminal_at = ?
        WHERE deliberation_id = ? AND state = 'leased' AND lease_id = ?
          AND requested_at_ms <= ?
      `).run(
        input.failureCode,
        input.failedAt,
        input.deliberationId,
        input.leaseId,
        failedAtMs,
      );
      if (result.changes !== 1) {
        throw new ConversationDeliberationSQLiteError(
          "lease_mismatch",
          "Conversation 숙의 queue 불확실 상태 lease가 다릅니다.",
        );
      }
    } catch (error) {
      this.writeError(error, "Conversation 숙의 queue 불확실 상태를 저장하지 못했습니다.");
    }
  }

  async reconcile(input: Parameters<ConversationDeliberationJobStore["reconcile"]>[0]) {
    this.assertOpen();
    reconcileConversationDeliberationJob(this.database, input);
  }

  checkIntegrity(): void {
    this.assertOpen();
    if (this.database.prepare("PRAGMA quick_check;").get()?.quick_check !== "ok") {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "Conversation 숙의 queue quick_check가 실패했습니다.",
      );
    }
    const required = new Set([
      "conversation_deliberation_job_identity_immutable",
      "conversation_deliberation_job_lifecycle",
      "conversation_deliberation_job_no_delete",
      "conversation_deliberation_jobs_active_lease",
    ]);
    for (const row of this.database.prepare(
      "SELECT name FROM sqlite_schema WHERE type IN ('trigger', 'index')",
    ).all()) {
      if (typeof row.name === "string") required.delete(row.name);
    }
    if (required.size > 0) {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "Conversation 숙의 queue 보호 schema가 누락되었습니다.",
      );
    }
    const rows = this.database.prepare("SELECT * FROM conversation_deliberation_jobs").all();
    if (rows.length > this.maxRecords) {
      throw new ConversationDeliberationSQLiteError(
        "capacity_exceeded",
        "Conversation 숙의 queue capacity를 초과했습니다.",
      );
    }
    rows.forEach(decodeConversationDeliberationJob);
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new ConversationDeliberationSQLiteError(
        "closed",
        "닫힌 Conversation 숙의 queue입니다.",
      );
    }
  }

  private rollback(error: unknown): never {
    try {
      this.database.exec("ROLLBACK;");
    } catch (rollbackError) {
      throw new ConversationDeliberationSQLiteError(
        "write_failed",
        "Conversation 숙의 queue transaction과 rollback이 실패했습니다.",
        { cause: new AggregateError([error, rollbackError]) },
      );
    }
    if (error instanceof ConversationDeliberationSQLiteError) throw error;
    throw new ConversationDeliberationSQLiteError(
      "write_failed",
      "Conversation 숙의 queue transaction이 실패했습니다.",
      { cause: error },
    );
  }

  private writeError(error: unknown, message: string): never {
    if (error instanceof ConversationDeliberationSQLiteError) throw error;
    throw new ConversationDeliberationSQLiteError("write_failed", message, { cause: error });
  }
}
