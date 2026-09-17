import { DatabaseSync } from "node:sqlite";

import {
  type ConversationDeliberationJobFailureCode,
  type ConversationDeliberationJobStore,
} from "@lervo/conversation-deliberation-contract";

import { migrateConversationDeliberationDatabase } from "./database.js";
import { ConversationDeliberationSQLiteError } from "./errors.js";
import {
  claimConversationDeliberationJob,
  markConversationDeliberationJobUncertain,
  renewConversationDeliberationJob,
  settleConversationDeliberationJob,
  type LeaseStoreConfiguration,
} from "./lease-store.js";
import { conversationDeliberationNotificationSchemaNames } from "./notification-database.js";
import {
  acceptConversationDeliberationNotification,
  checkConversationDeliberationNotificationIntegrity,
  claimConversationDeliberationNotification,
  nextConversationDeliberationNotificationWakeupAt,
} from "./notification-store.js";
import {
  assertConversationDeliberationLookup,
  conversationDeliberationMilliseconds,
  decodeConversationDeliberationJob,
} from "./row-codec.js";
import { reconcileConversationDeliberationJob } from "./reconciliation.js";
import {
  checkConversationDeliberationQueueIntegrity,
  openConversationDeliberationQueueDatabase,
  resolveConversationDeliberationMaximumRecords,
  rollbackConversationDeliberationQueueTransaction,
} from "./store-core.js";

const leaseConfiguration: LeaseStoreConfiguration<
  ReturnType<typeof decodeConversationDeliberationJob>,
  ConversationDeliberationJobFailureCode
> = {
  table: "conversation_deliberation_jobs",
  leasePrefix: "cdl",
  expiredFailureCode: "worker_lease_expired",
  label: "conversation deliberation queue",
  decode: decodeConversationDeliberationJob,
};

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

  nextWakeupAt(): number | null {
    this.assertOpen();
    const work = this.database
      .prepare(
        "SELECT MIN(CASE WHEN state = 'queued' THEN requested_at_ms ELSE lease_expires_at_ms END) AS next_at FROM conversation_deliberation_jobs WHERE state IN ('queued', 'leased')",
      )
      .get()?.next_at;
    const notification = nextConversationDeliberationNotificationWakeupAt(this.database);
    const values = [work, notification].filter(
      (value): value is number => typeof value === "number",
    );
    return values.length === 0 ? null : Math.min(...values);
  }

  static async open(options: {
    path: string;
    maxRecords?: number;
  }): Promise<SQLiteConversationDeliberationJobStore> {
    const maxRecords = resolveConversationDeliberationMaximumRecords(
      options.maxRecords,
      leaseConfiguration.label,
    );
    const { path, database } = await openConversationDeliberationQueueDatabase({
      path: options.path,
      migrate: migrateConversationDeliberationDatabase,
    });
    try {
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
    const requestedAtMs = conversationDeliberationMilliseconds(
      input.requestedAt,
      "deliberation request",
    );
    const candidate = decodeConversationDeliberationJob({
      project_id: input.projectId,
      source_event_id: input.sourceEventId,
      deliberation_id: input.deliberationId,
      request_hash: input.requestHash,
      principal_hash: input.principalHash,
      origin_conversation_id: input.origin.conversationId,
      origin_thread_id: input.origin.threadId,
      origin_requester_participant_id: input.origin.requesterParticipantId,
      origin_binding_digest: input.origin.originBindingDigest,
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
      const row = this.database
        .prepare(
          `
        SELECT * FROM conversation_deliberation_jobs
        WHERE project_id = ? AND source_event_id = ?
      `,
        )
        .get(input.projectId, input.sourceEventId);
      if (row !== undefined) {
        const existing = decodeConversationDeliberationJob(row);
        if (
          existing.requestHash !== input.requestHash ||
          existing.deliberationId !== input.deliberationId
        ) {
          throw new ConversationDeliberationSQLiteError(
            "deliberation_request_conflict",
            "The same conversation event was used for a different deliberation request.",
          );
        }
        this.database.exec("COMMIT;");
        return existing;
      }
      const count = this.database
        .prepare("SELECT COUNT(*) AS count FROM conversation_deliberation_jobs")
        .get()?.count;
      if (typeof count !== "number" || !Number.isSafeInteger(count)) {
        throw new ConversationDeliberationSQLiteError(
          "integrity_failed",
          "The conversation deliberation queue count is invalid.",
        );
      }
      if (count >= this.maxRecords) {
        throw new ConversationDeliberationSQLiteError(
          "capacity_exceeded",
          "The conversation deliberation queue capacity was exceeded.",
        );
      }
      this.database
        .prepare(
          `
        INSERT INTO conversation_deliberation_jobs (
          project_id, source_event_id, deliberation_id, request_hash, principal_hash,
          origin_conversation_id, origin_thread_id, origin_requester_participant_id,
          origin_binding_digest,
          policy_id, topic, requested_at, requested_at_ms, state, attempt_count,
          lease_id, lease_owner, lease_expires_at, lease_expires_at_ms,
          summary_json, failure_code, terminal_at, reconciliation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0,
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
      `,
        )
        .run(
          candidate.projectId,
          candidate.sourceEventId,
          candidate.deliberationId,
          candidate.requestHash,
          candidate.principalHash,
          candidate.origin!.conversationId,
          candidate.origin!.threadId,
          candidate.origin!.requesterParticipantId,
          candidate.origin!.originBindingDigest,
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
    const row = this.database
      .prepare(
        `
      SELECT * FROM conversation_deliberation_jobs
      WHERE project_id = ? AND deliberation_id = ?
    `,
      )
      .get(input.projectId, input.deliberationId);
    return row === undefined ? null : decodeConversationDeliberationJob(row);
  }

  async listUncertain(input: Parameters<ConversationDeliberationJobStore["listUncertain"]>[0]) {
    this.assertOpen();
    if (
      !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(input.projectId) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "The uncertain deliberation query is invalid.",
      );
    }
    return this.database
      .prepare(
        "SELECT * FROM conversation_deliberation_jobs WHERE project_id = ? AND state = 'uncertain' ORDER BY terminal_at, deliberation_id LIMIT ?",
      )
      .all(input.projectId, input.limit)
      .map((row) => {
        const job = decodeConversationDeliberationJob(row);
        const uncertainAt = row.terminal_at;
        if (typeof uncertainAt !== "string") {
          throw new ConversationDeliberationSQLiteError(
            "integrity_failed",
            "The uncertain deliberation has no terminal time.",
          );
        }
        return { deliberationId: job.deliberationId, uncertainAt };
      });
  }

  async claim(input: Parameters<ConversationDeliberationJobStore["claim"]>[0]) {
    this.assertOpen();
    return claimConversationDeliberationJob({
      database: this.database,
      ...input,
      configuration: leaseConfiguration,
    });
  }

  async renew(input: Parameters<ConversationDeliberationJobStore["renew"]>[0]) {
    this.assertOpen();
    renewConversationDeliberationJob({
      database: this.database,
      ...input,
      configuration: leaseConfiguration,
    });
  }

  async settle(input: Parameters<ConversationDeliberationJobStore["settle"]>[0]) {
    this.assertOpen();
    settleConversationDeliberationJob({
      database: this.database,
      ...input,
      configuration: leaseConfiguration,
    });
  }

  async markUncertain(input: Parameters<ConversationDeliberationJobStore["markUncertain"]>[0]) {
    this.assertOpen();
    markConversationDeliberationJobUncertain({
      database: this.database,
      ...input,
      configuration: leaseConfiguration,
    });
  }

  async claimNotification(
    input: Parameters<ConversationDeliberationJobStore["claimNotification"]>[0],
  ) {
    this.assertOpen();
    return claimConversationDeliberationNotification({
      database: this.database,
      operation: "start",
      ...input,
    });
  }

  async acceptNotification(
    input: Parameters<ConversationDeliberationJobStore["acceptNotification"]>[0],
  ) {
    this.assertOpen();
    acceptConversationDeliberationNotification({ database: this.database, ...input });
  }

  async reconcile(input: Parameters<ConversationDeliberationJobStore["reconcile"]>[0]) {
    this.assertOpen();
    reconcileConversationDeliberationJob(this.database, input);
  }

  checkIntegrity(): void {
    this.assertOpen();
    checkConversationDeliberationQueueIntegrity({
      database: this.database,
      table: leaseConfiguration.table,
      requiredSchema: [
        "conversation_deliberation_job_identity_immutable",
        "conversation_deliberation_job_lifecycle",
        "conversation_deliberation_job_no_delete",
        "conversation_deliberation_jobs_active_lease",
        ...conversationDeliberationNotificationSchemaNames,
      ],
      maximumRecords: this.maxRecords,
      label: leaseConfiguration.label,
      decode: decodeConversationDeliberationJob,
    });
    checkConversationDeliberationNotificationIntegrity({
      database: this.database,
      operation: "start",
      maximumRecords: this.maxRecords,
    });
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
        "The conversation deliberation queue is closed.",
      );
    }
  }

  private rollback(error: unknown): never {
    rollbackConversationDeliberationQueueTransaction(
      this.database,
      error,
      leaseConfiguration.label,
    );
  }
}
