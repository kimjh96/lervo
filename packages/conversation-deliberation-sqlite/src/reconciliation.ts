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
      "Conversation 숙의 queue 대조 transaction과 rollback이 실패했습니다.",
      { cause: new AggregateError([error, rollbackError]) },
    );
  }
  if (error instanceof ConversationDeliberationSQLiteError) throw error;
  throw new ConversationDeliberationSQLiteError(
    "write_failed",
    "Conversation 숙의 queue 대조 transaction이 실패했습니다.",
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
      "Conversation 숙의 queue 대조 좌표가 유효하지 않습니다.",
    );
  }
  const reconciledAtMs = conversationDeliberationMilliseconds(input.reconciledAt, "숙의 대조");
  const encodedSummary = JSON.stringify(input.summary);
  decodeConversationDeliberationSummary(encodedSummary, input.deliberationId);
  if (input.summary.status === "unknown") {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "Conversation 숙의 queue 대조 결과가 확정되지 않았습니다.",
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
        "Conversation 숙의 queue 대조 대상이 다릅니다.",
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
        "Conversation 숙의 queue가 대조 가능한 불확실 상태가 아닙니다.",
      );
    }
    const uncertainAt = row.terminal_at;
    if (typeof uncertainAt !== "string" ||
      reconciledAtMs < conversationDeliberationMilliseconds(uncertainAt, "숙의 불확실")) {
      throw new ConversationDeliberationSQLiteError(
        "integrity_failed",
        "Conversation 숙의 queue 대조가 불확실 상태보다 빠릅니다.",
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
        "Conversation 숙의 queue 대조 상태를 저장하지 못했습니다.",
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
