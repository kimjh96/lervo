import { DatabaseSync } from "node:sqlite";

import {
  type ConversationDeliberationResumeJobFailureCode,
  type ConversationDeliberationResumeJobStore,
} from "@lervo/conversation-deliberation-contract";

import { ConversationDeliberationSQLiteError } from "./errors.js";
import {
  claimConversationDeliberationJob,
  markConversationDeliberationJobUncertain,
  renewConversationDeliberationJob,
  settleConversationDeliberationJob,
  type LeaseStoreConfiguration,
} from "./lease-store.js";
import { reconcileConversationDeliberationRecord } from "./reconciliation.js";
import { migrateConversationDeliberationResumeDatabase } from "./resume-database.js";
import { decodeConversationDeliberationResumeJob } from "./resume-row-codec.js";
import {
  assertConversationDeliberationLookup,
  conversationDeliberationMilliseconds,
} from "./row-codec.js";
import {
  checkConversationDeliberationQueueIntegrity,
  openConversationDeliberationQueueDatabase,
  resolveConversationDeliberationMaximumRecords,
  rollbackConversationDeliberationQueueTransaction,
} from "./store-core.js";

const leaseConfiguration: LeaseStoreConfiguration<
  ReturnType<typeof decodeConversationDeliberationResumeJob>,
  ConversationDeliberationResumeJobFailureCode
> = {
  table: "conversation_deliberation_resume_jobs",
  leasePrefix: "cdr",
  expiredFailureCode: "resume_worker_lease_expired",
  label: "conversation deliberation resume queue",
  decode: decodeConversationDeliberationResumeJob,
};

export class SQLiteConversationDeliberationResumeJobStore implements ConversationDeliberationResumeJobStore {
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
  }): Promise<SQLiteConversationDeliberationResumeJobStore> {
    const maxRecords = resolveConversationDeliberationMaximumRecords(
      options.maxRecords,
      leaseConfiguration.label,
    );
    const { path, database } = await openConversationDeliberationQueueDatabase({
      path: options.path,
      migrate: migrateConversationDeliberationResumeDatabase,
    });
    try {
      const store = new SQLiteConversationDeliberationResumeJobStore(path, database, maxRecords);
      store.checkIntegrity();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async enqueue(input: Parameters<ConversationDeliberationResumeJobStore["enqueue"]>[0]) {
    this.assertOpen();
    const requestedAtMs = conversationDeliberationMilliseconds(
      input.requestedAt,
      "deliberation resume request",
    );
    const candidate = decodeConversationDeliberationResumeJob({
      project_id: input.projectId,
      source_event_id: input.sourceEventId,
      deliberation_id: input.deliberationId,
      request_hash: input.requestHash,
      principal_hash: input.principalHash,
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
      const sameEvent = this.database
        .prepare(
          `
        SELECT * FROM conversation_deliberation_resume_jobs
        WHERE project_id = ? AND source_event_id = ?
      `,
        )
        .get(input.projectId, input.sourceEventId);
      if (sameEvent !== undefined) {
        const existing = decodeConversationDeliberationResumeJob(sameEvent);
        if (
          existing.requestHash !== input.requestHash ||
          existing.deliberationId !== input.deliberationId
        ) {
          throw new ConversationDeliberationSQLiteError(
            "deliberation_resume_conflict",
            "The same conversation event was used for a different deliberation resume request.",
          );
        }
        this.database.exec("COMMIT;");
        return existing;
      }
      const sameDeliberation = this.database
        .prepare(
          `
        SELECT 1 FROM conversation_deliberation_resume_jobs
        WHERE project_id = ? AND deliberation_id = ?
      `,
        )
        .get(input.projectId, input.deliberationId);
      if (sameDeliberation !== undefined) {
        throw new ConversationDeliberationSQLiteError(
          "deliberation_resume_conflict",
          "This deliberation already has a different resume request.",
        );
      }
      const count = this.database
        .prepare("SELECT COUNT(*) AS count FROM conversation_deliberation_resume_jobs")
        .get()?.count;
      if (typeof count !== "number" || !Number.isSafeInteger(count)) {
        throw new ConversationDeliberationSQLiteError(
          "integrity_failed",
          "The conversation deliberation resume queue count is invalid.",
        );
      }
      if (count >= this.maxRecords) {
        throw new ConversationDeliberationSQLiteError(
          "capacity_exceeded",
          "The conversation deliberation resume queue capacity was exceeded.",
        );
      }
      this.database
        .prepare(
          `
        INSERT INTO conversation_deliberation_resume_jobs (
          project_id, source_event_id, deliberation_id, request_hash, principal_hash,
          requested_at, requested_at_ms, state, attempt_count, lease_id, lease_owner,
          lease_expires_at, lease_expires_at_ms, summary_json, failure_code,
          terminal_at, reconciliation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
      `,
        )
        .run(
          candidate.projectId,
          candidate.sourceEventId,
          candidate.deliberationId,
          candidate.requestHash,
          candidate.principalHash,
          candidate.requestedAt,
          requestedAtMs,
        );
      this.database.exec("COMMIT;");
      return candidate;
    } catch (error) {
      this.rollback(error);
    }
  }

  async inspect(input: Parameters<ConversationDeliberationResumeJobStore["inspect"]>[0]) {
    this.assertOpen();
    assertConversationDeliberationLookup(input);
    const row = this.database
      .prepare(
        `
      SELECT * FROM conversation_deliberation_resume_jobs
      WHERE project_id = ? AND deliberation_id = ?
    `,
      )
      .get(input.projectId, input.deliberationId);
    return row === undefined ? null : decodeConversationDeliberationResumeJob(row);
  }

  async claim(input: Parameters<ConversationDeliberationResumeJobStore["claim"]>[0]) {
    this.assertOpen();
    return claimConversationDeliberationJob({
      database: this.database,
      ...input,
      configuration: leaseConfiguration,
    });
  }

  async renew(input: Parameters<ConversationDeliberationResumeJobStore["renew"]>[0]) {
    this.assertOpen();
    renewConversationDeliberationJob({
      database: this.database,
      ...input,
      configuration: leaseConfiguration,
    });
  }

  async settle(input: Parameters<ConversationDeliberationResumeJobStore["settle"]>[0]) {
    this.assertOpen();
    settleConversationDeliberationJob({
      database: this.database,
      ...input,
      configuration: leaseConfiguration,
    });
  }

  async markUncertain(
    input: Parameters<ConversationDeliberationResumeJobStore["markUncertain"]>[0],
  ) {
    this.assertOpen();
    markConversationDeliberationJobUncertain({
      database: this.database,
      ...input,
      configuration: leaseConfiguration,
    });
  }

  async reconcile(input: Parameters<ConversationDeliberationResumeJobStore["reconcile"]>[0]) {
    this.assertOpen();
    if (input.summary.status === "interrupted" || input.summary.status === "unknown") {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "The conversation deliberation resume queue reconciliation result is not terminal.",
      );
    }
    reconcileConversationDeliberationRecord(this.database, input, {
      table: "conversation_deliberation_resume_jobs",
      decode: decodeConversationDeliberationResumeJob,
    });
  }

  checkIntegrity(): void {
    this.assertOpen();
    checkConversationDeliberationQueueIntegrity({
      database: this.database,
      table: leaseConfiguration.table,
      requiredSchema: [
        "conversation_deliberation_resume_job_identity_immutable",
        "conversation_deliberation_resume_job_lifecycle",
        "conversation_deliberation_resume_job_no_delete",
        "conversation_deliberation_resume_jobs_active_lease",
      ],
      maximumRecords: this.maxRecords,
      label: leaseConfiguration.label,
      decode: decodeConversationDeliberationResumeJob,
    });
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed)
      throw new ConversationDeliberationSQLiteError(
        "closed",
        "The conversation deliberation resume queue is closed.",
      );
  }

  private rollback(error: unknown): never {
    rollbackConversationDeliberationQueueTransaction(
      this.database,
      error,
      leaseConfiguration.label,
    );
  }
}
