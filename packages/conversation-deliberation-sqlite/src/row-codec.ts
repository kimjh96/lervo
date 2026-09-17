import {
  calculateConversationDeliberationOriginBindingDigest,
  conversationDeliberationPatterns,
  type ConversationDeliberationJob,
  type ConversationDeliberationJobFailureCode,
  type ConversationDeliberationJobReconciliation,
  type ConversationDeliberationSummary,
} from "@lervo/conversation-deliberation-contract";

import { ConversationDeliberationSQLiteError } from "./errors.js";

type Row = Record<string, unknown>;

const hashPattern = /^sha256:[a-f0-9]{64}$/u;
const projectIdPattern = /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const eventIdPattern = /^cve_[a-f0-9]{64}$/u;
const deliberationIdPattern = /^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const policyIdPattern = /^deliberation_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The conversation deliberation queue ${key} value is invalid.`,
    );
  }
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The conversation deliberation queue ${key} value is invalid.`,
    );
  }
  return value;
}

function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The conversation deliberation queue ${key} value is invalid.`,
    );
  }
  return value;
}

function nullableInteger(row: Row, key: string): number | null {
  const value = row[key];
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value))) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The conversation deliberation queue ${key} value is invalid.`,
    );
  }
  return value;
}

export function conversationDeliberationMilliseconds(value: string, label: string): number {
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new ConversationDeliberationSQLiteError("integrity_failed", `${label} time is invalid.`);
  }
  return result;
}

export function decodeConversationDeliberationSummary(
  value: string | null,
  deliberationId: string,
): ConversationDeliberationSummary | null {
  if (value === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch (error) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation queue result JSON is invalid.",
      { cause: error },
    );
  }
  const item = decoded as Partial<ConversationDeliberationSummary>;
  const action = (
    {
      running: "wait",
      unknown: "none",
      interrupted: "resume",
      converged: "none",
      no_consensus: "none",
      failed: "none",
    } as const
  )[item.status as ConversationDeliberationSummary["status"]];
  if (
    item.deliberationId !== deliberationId ||
    action === undefined ||
    item.status === "running" ||
    item.nextAction !== action ||
    !Number.isSafeInteger(item.artifactCount) ||
    item.artifactCount! < 0 ||
    item.artifactCount! > 10_000
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation queue result coordinates are invalid.",
    );
  }
  return item as ConversationDeliberationSummary;
}

export function assertConversationDeliberationLookup(input: {
  projectId: string;
  deliberationId: string;
}): void {
  if (
    !projectIdPattern.test(input.projectId) ||
    !deliberationIdPattern.test(input.deliberationId)
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation queue query coordinates are invalid.",
    );
  }
}

function decodeReconciliation(
  value: string | null,
  requestedAtMs: number,
): ConversationDeliberationJobReconciliation | null {
  if (value === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch (error) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation queue reconciliation JSON is invalid.",
      { cause: error },
    );
  }
  const item = decoded as Partial<ConversationDeliberationJobReconciliation> & {
    schemaVersion?: unknown;
  };
  const uncertainAtMs =
    typeof item.uncertainAt === "string"
      ? conversationDeliberationMilliseconds(item.uncertainAt, "deliberation uncertainty")
      : -1;
  const reconciledAtMs =
    typeof item.reconciledAt === "string"
      ? conversationDeliberationMilliseconds(item.reconciledAt, "deliberation reconciliation")
      : -1;
  if (
    item.schemaVersion !== 1 ||
    typeof item.sourceKind !== "string" ||
    !conversationDeliberationPatterns.reconciliationSourceKind.test(item.sourceKind) ||
    typeof item.evidenceHash !== "string" ||
    !hashPattern.test(item.evidenceHash) ||
    (item.priorFailureCode !== "worker_lease_expired" &&
      item.priorFailureCode !== "deliberation_execution_uncertain") ||
    uncertainAtMs < requestedAtMs ||
    reconciledAtMs < uncertainAtMs
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation queue reconciliation coordinates are invalid.",
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

export function decodeConversationDeliberationJob(row: Row): ConversationDeliberationJob {
  const projectId = text(row, "project_id");
  const sourceEventId = text(row, "source_event_id");
  const deliberationId = text(row, "deliberation_id");
  const requestHash = text(row, "request_hash");
  const principalHash = text(row, "principal_hash");
  const originConversationId = nullableText(row, "origin_conversation_id");
  const originThreadId = nullableText(row, "origin_thread_id");
  const originRequesterParticipantId = nullableText(row, "origin_requester_participant_id");
  const originBindingDigest = nullableText(row, "origin_binding_digest");
  const policyId = text(row, "policy_id");
  const topic = text(row, "topic");
  const requestedAt = text(row, "requested_at");
  const state = text(row, "state") as ConversationDeliberationJob["state"];
  const attemptCount = integer(row, "attempt_count");
  const leaseExpiresAt = nullableText(row, "lease_expires_at");
  const leaseExpiresAtMs = nullableInteger(row, "lease_expires_at_ms");
  const leaseId = nullableText(row, "lease_id");
  const leaseOwner = nullableText(row, "lease_owner");
  const terminalAt = nullableText(row, "terminal_at");
  const failureCode = nullableText(
    row,
    "failure_code",
  ) as ConversationDeliberationJobFailureCode | null;
  const requestedAtMs = integer(row, "requested_at_ms");
  const reconciliation = decodeReconciliation(
    nullableText(row, "reconciliation_json"),
    requestedAtMs,
  );
  const originValues = [originConversationId, originRequesterParticipantId, originBindingDigest];
  const originMissing = originValues.every((value) => value === null) && originThreadId === null;
  const originValid =
    originConversationId !== null &&
    conversationDeliberationPatterns.conversationId.test(originConversationId) &&
    (originThreadId === null || conversationDeliberationPatterns.threadId.test(originThreadId)) &&
    originRequesterParticipantId !== null &&
    conversationDeliberationPatterns.participantId.test(originRequesterParticipantId) &&
    originBindingDigest !== null &&
    hashPattern.test(originBindingDigest);
  const originDigestMatches =
    originValid &&
    originBindingDigest ===
      calculateConversationDeliberationOriginBindingDigest({
        projectId,
        sourceEventId,
        conversationId: originConversationId,
        threadId: originThreadId,
        requesterParticipantId: originRequesterParticipantId,
      });
  if (
    !projectIdPattern.test(projectId) ||
    !eventIdPattern.test(sourceEventId) ||
    !deliberationIdPattern.test(deliberationId) ||
    !hashPattern.test(requestHash) ||
    !hashPattern.test(principalHash) ||
    (!originMissing && (!originValid || !originDigestMatches)) ||
    !policyIdPattern.test(policyId) ||
    topic.length < 1 ||
    topic.length > 4_096 ||
    !new Set(["queued", "leased", "settled", "uncertain"]).has(state) ||
    attemptCount < 0 ||
    attemptCount > 100_000 ||
    (leaseId !== null && !/^cdl_[A-Za-z0-9_-]{32}$/u.test(leaseId)) ||
    (leaseOwner !== null && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(leaseOwner)) ||
    (failureCode !== null &&
      failureCode !== "worker_lease_expired" &&
      failureCode !== "deliberation_execution_uncertain") ||
    (reconciliation !== null && state !== "settled")
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation queue record is invalid.",
    );
  }
  if (conversationDeliberationMilliseconds(requestedAt, "deliberation request") !== requestedAtMs) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation queue request time coordinates differ.",
    );
  }
  if (
    leaseExpiresAt !== null &&
    (leaseExpiresAtMs === null ||
      conversationDeliberationMilliseconds(leaseExpiresAt, "deliberation lease expiration") !==
        leaseExpiresAtMs)
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation queue lease time coordinates differ.",
    );
  }
  if (
    terminalAt !== null &&
    conversationDeliberationMilliseconds(terminalAt, "deliberation queue settlement") <
      requestedAtMs
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation queue settlement is earlier than the request.",
    );
  }
  if (reconciliation !== null && terminalAt !== reconciliation.reconciledAt) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation queue reconciliation and settlement times differ.",
    );
  }
  return {
    operation: "start",
    projectId,
    sourceEventId,
    deliberationId,
    requestHash,
    principalHash,
    origin: originMissing
      ? null
      : {
          conversationId: originConversationId!,
          threadId: originThreadId,
          requesterParticipantId: originRequesterParticipantId!,
          originBindingDigest: originBindingDigest!,
        },
    policyId,
    topic,
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
