import type { DatabaseSync } from "node:sqlite";

import {
  conversationDeliberationPatterns,
  type ConversationDeliberationReconciliationRecord,
  type ConversationDeliberationReconciliationTarget,
  type ConversationDeliberationJobStore,
} from "@lervo/conversation-deliberation-contract";

import { ConversationDeliberationSQLiteError } from "./errors.js";
import {
  assertConversationDeliberationLookup,
  conversationDeliberationMilliseconds,
  decodeConversationDeliberationJob,
  decodeConversationDeliberationSummary,
} from "./row-codec.js";

type ReconciliationInput = Parameters<ConversationDeliberationJobStore["reconcile"]>[0];
type ReconciliationDatabaseJob = ConversationDeliberationReconciliationTarget & {
  failureCode: string | null;
  reconciliation: ConversationDeliberationReconciliationRecord<string> | null;
};

function sameSummary(
  left: NonNullable<ReturnType<typeof decodeConversationDeliberationSummary>>,
  right: ReconciliationInput["summary"],
): boolean {
  return left.deliberationId === right.deliberationId && left.status === right.status &&
    left.artifactCount === right.artifactCount && left.nextAction === right.nextAction;
}

function rollback(database: DatabaseSync, error: unknown): never {
  try {
    database.exec("ROLLBACK;");
  } catch (rollbackError) {
    throw new ConversationDeliberationSQLiteError(
      "write_failed",
      "The conversation deliberation queue reconciliation transaction and rollback both failed.",
      { cause: new AggregateError([error, rollbackError]) },
    );
  }
  if (error instanceof ConversationDeliberationSQLiteError) throw error;
  throw new ConversationDeliberationSQLiteError(
    "write_failed",
    "The conversation deliberation queue reconciliation transaction failed.",
    { cause: error },
  );
}

export function reconcileConversationDeliberationRecord(
  database: DatabaseSync,
  input: ReconciliationInput,
  options: {
    table: "conversation_deliberation_jobs" | "conversation_deliberation_resume_jobs";
    decode(row: Record<string, unknown>): ReconciliationDatabaseJob;
  },
): void {
  assertConversationDeliberationLookup(input);
  if (!conversationDeliberationPatterns.reconciliationSourceKind.test(input.sourceKind) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.requestHash) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.evidenceHash)) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation queue reconciliation coordinates are invalid.",
    );
  }
  const reconciledAtMs = conversationDeliberationMilliseconds(input.reconciledAt, "deliberation reconciliation");
  const encodedSummary = JSON.stringify(input.summary);
  decodeConversationDeliberationSummary(encodedSummary, input.deliberationId);
  if (input.summary.status === "unknown") {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation queue reconciliation result is not resolved.",
    );
  }

  database.exec("BEGIN IMMEDIATE;");
  try {
    const row = database.prepare(`
      SELECT * FROM ${options.table}
      WHERE project_id = ? AND deliberation_id = ? AND request_hash = ?
    `).get(input.projectId, input.deliberationId, input.requestHash);
    if (row === undefined) {
      throw new ConversationDeliberationSQLiteError(
        "lease_mismatch",
        "The conversation deliberation queue reconciliation target differs.",
      );
    }
    const job = options.decode(row);
    if (
      job.state === "settled" && job.reconciliation !== null && job.summary !== null &&
      sameSummary(job.summary, input.summary)
    ) {
      database.exec("COMMIT;");
      return;
    }
    if (job.state !== "uncertain" || job.failureCode === null) {
      throw new ConversationDeliberationSQLiteError(
        "lease_mismatch",
        "The conversation deliberation queue is not in a reconcilable uncertain state.",
      );
    }
    const uncertainAt = row.terminal_at;
    if (typeof uncertainAt !== "string" ||
      reconciledAtMs < conversationDeliberationMilliseconds(uncertainAt, "deliberation uncertainty")) {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "The conversation deliberation queue reconciliation is earlier than the uncertain state.",
      );
    }
    const reconciliation = JSON.stringify({
      schemaVersion: 1,
      sourceKind: input.sourceKind,
      evidenceHash: input.evidenceHash,
      priorFailureCode: job.failureCode,
      uncertainAt,
      reconciledAt: input.reconciledAt,
    });
    const updated = database.prepare(`
      UPDATE ${options.table} SET
        state = 'settled', summary_json = ?, failure_code = NULL,
        terminal_at = ?, reconciliation_json = ?
      WHERE project_id = ? AND deliberation_id = ? AND request_hash = ?
        AND state = 'uncertain'
    `).run(
      encodedSummary,
      input.reconciledAt,
      reconciliation,
      input.projectId,
      input.deliberationId,
      input.requestHash,
    );
    if (updated.changes !== 1) {
      throw new ConversationDeliberationSQLiteError(
        "lease_mismatch",
        "Could not store the conversation deliberation queue reconciliation state.",
      );
    }
    database.exec("COMMIT;");
  } catch (error) {
    rollback(database, error);
  }
}

export function reconcileConversationDeliberationJob(
  database: DatabaseSync,
  input: ReconciliationInput,
): void {
  reconcileConversationDeliberationRecord(database, input, {
    table: "conversation_deliberation_jobs",
    decode: decodeConversationDeliberationJob,
  });
}
