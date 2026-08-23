import {
  conversationDeliberationPatterns,
  type ConversationDeliberationResumeJob,
  type ConversationDeliberationResumeJobFailureCode,
  type ConversationDeliberationResumeJobReconciliation,
} from "@lervo/conversation-deliberation-contract";

import { ConversationDeliberationSQLiteError } from "./errors.js";
import {
  conversationDeliberationMilliseconds,
  decodeConversationDeliberationSummary,
} from "./row-codec.js";

type Row = Record<string, unknown>;
const hashPattern = /^sha256:[a-f0-9]{64}$/u;

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The conversation deliberation resume queue ${key} value is invalid.`,
    );
  }
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The conversation deliberation resume queue ${key} value is invalid.`,
    );
  }
  return value;
}

function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The conversation deliberation resume queue ${key} value is invalid.`,
    );
  }
  return value;
}

function nullableInteger(row: Row, key: string): number | null {
  const value = row[key];
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value))) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The conversation deliberation resume queue ${key} value is invalid.`,
    );
  }
  return value;
}

function decodeReconciliation(
  value: string | null,
  requestedAtMs: number,
): ConversationDeliberationResumeJobReconciliation | null {
  if (value === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch (error) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation resume queue reconciliation JSON is invalid.",
      { cause: error },
    );
  }
  const item = decoded as Partial<ConversationDeliberationResumeJobReconciliation> & {
    schemaVersion?: unknown;
  };
  const uncertainAtMs = typeof item.uncertainAt === "string"
    ? conversationDeliberationMilliseconds(item.uncertainAt, "deliberation resume uncertainty")
    : -1;
  const reconciledAtMs = typeof item.reconciledAt === "string"
    ? conversationDeliberationMilliseconds(item.reconciledAt, "deliberation resume reconciliation")
    : -1;
  if (
    item.schemaVersion !== 1 || typeof item.sourceKind !== "string" ||
    !conversationDeliberationPatterns.reconciliationSourceKind.test(item.sourceKind) ||
    typeof item.evidenceHash !== "string" || !hashPattern.test(item.evidenceHash) ||
    (item.priorFailureCode !== "resume_worker_lease_expired" &&
      item.priorFailureCode !== "deliberation_resume_execution_uncertain") ||
    uncertainAtMs < requestedAtMs || reconciledAtMs < uncertainAtMs
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation resume queue reconciliation coordinates are invalid.",
    );
  }
  return {
    sourceKind: item.sourceKind,
    evidenceHash: item.evidenceHash,
    priorFailureCode: item.priorFailureCode,
    uncertainAt: item.uncertainAt!,
    reconciledAt: item.reconciledAt!,
  };
}

export function decodeConversationDeliberationResumeJob(row: Row): ConversationDeliberationResumeJob {
  const projectId = text(row, "project_id");
  const sourceEventId = text(row, "source_event_id");
  const deliberationId = text(row, "deliberation_id");
  const requestHash = text(row, "request_hash");
  const principalHash = text(row, "principal_hash");
  const requestedAt = text(row, "requested_at");
  const requestedAtMs = integer(row, "requested_at_ms");
  const state = text(row, "state") as ConversationDeliberationResumeJob["state"];
  const attemptCount = integer(row, "attempt_count");
  const leaseId = nullableText(row, "lease_id");
  const leaseOwner = nullableText(row, "lease_owner");
  const leaseExpiresAt = nullableText(row, "lease_expires_at");
  const leaseExpiresAtMs = nullableInteger(row, "lease_expires_at_ms");
  const terminalAt = nullableText(row, "terminal_at");
  const failureCode = nullableText(row, "failure_code") as
    ConversationDeliberationResumeJobFailureCode | null;
  const reconciliation = decodeReconciliation(
    nullableText(row, "reconciliation_json"),
    requestedAtMs,
  );
  if (
    !conversationDeliberationPatterns.projectId.test(projectId) ||
    !conversationDeliberationPatterns.sourceEventId.test(sourceEventId) ||
    !conversationDeliberationPatterns.deliberationId.test(deliberationId) ||
    !hashPattern.test(requestHash) || !hashPattern.test(principalHash) ||
    !(new Set(["queued", "leased", "settled", "uncertain"])).has(state) ||
    attemptCount < 0 || attemptCount > 100_000 ||
    (leaseId !== null && !/^cdr_[A-Za-z0-9_-]{32}$/u.test(leaseId)) ||
    (leaseOwner !== null && !conversationDeliberationPatterns.workerId.test(leaseOwner)) ||
    (failureCode !== null && failureCode !== "resume_worker_lease_expired" &&
      failureCode !== "deliberation_resume_execution_uncertain") ||
    (reconciliation !== null && state !== "settled")
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation resume queue record is invalid.",
    );
  }
  if (conversationDeliberationMilliseconds(requestedAt, "deliberation resume request") !== requestedAtMs) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation resume queue request time coordinates differ.",
    );
  }
  if (leaseExpiresAt !== null && (
    leaseExpiresAtMs === null ||
    conversationDeliberationMilliseconds(leaseExpiresAt, "deliberation resume lease expiration") !== leaseExpiresAtMs
  )) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation resume queue lease time coordinates differ.",
    );
  }
  if (terminalAt !== null &&
    conversationDeliberationMilliseconds(terminalAt, "deliberation resume queue settlement") < requestedAtMs) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation resume queue settlement is earlier than the request.",
    );
  }
  if (reconciliation !== null && terminalAt !== reconciliation.reconciledAt) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation resume queue reconciliation and settlement times differ.",
    );
  }
  return {
    operation: "resume",
    projectId,
    sourceEventId,
    deliberationId,
    requestHash,
    principalHash,
    requestedAt,
    state,
    attemptCount,
    leaseExpiresAt,
    summary: decodeConversationDeliberationSummary(
      nullableText(row, "summary_json"),
      deliberationId,
    ),
    failureCode,
    reconciliation,
  };
}
