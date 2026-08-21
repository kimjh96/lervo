import type {
  ConversationDeliberationJob,
  ConversationDeliberationJobFailureCode,
  ConversationDeliberationSummary,
} from "@lervo/conversation-control";

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
      `Conversation 숙의 queue ${key} 값이 유효하지 않습니다.`,
    );
  }
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `Conversation 숙의 queue ${key} 값이 유효하지 않습니다.`,
    );
  }
  return value;
}

function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `Conversation 숙의 queue ${key} 값이 유효하지 않습니다.`,
    );
  }
  return value;
}

function nullableInteger(row: Row, key: string): number | null {
  const value = row[key];
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value))) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `Conversation 숙의 queue ${key} 값이 유효하지 않습니다.`,
    );
  }
  return value;
}

export function conversationDeliberationMilliseconds(value: string, label: string): number {
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `${label} 시각이 유효하지 않습니다.`,
    );
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
      "Conversation 숙의 queue 결과 JSON이 유효하지 않습니다.",
      { cause: error },
    );
  }
  const item = decoded as Partial<ConversationDeliberationSummary>;
  const action = ({
    running: "wait",
    unknown: "none",
    interrupted: "resume",
    converged: "none",
    no_consensus: "none",
    failed: "none",
  } as const)[item.status as ConversationDeliberationSummary["status"]];
  if (
    item.deliberationId !== deliberationId || action === undefined ||
    item.status === "running" ||
    item.nextAction !== action || !Number.isSafeInteger(item.artifactCount) ||
    item.artifactCount! < 0 || item.artifactCount! > 10_000
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "Conversation 숙의 queue 결과 좌표가 유효하지 않습니다.",
    );
  }
  return item as ConversationDeliberationSummary;
}

export function assertConversationDeliberationLookup(input: {
  projectId: string;
  deliberationId: string;
}): void {
  if (!projectIdPattern.test(input.projectId) || !deliberationIdPattern.test(input.deliberationId)) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "Conversation 숙의 queue 조회 좌표가 유효하지 않습니다.",
    );
  }
}

export function decodeConversationDeliberationJob(row: Row): ConversationDeliberationJob {
  const projectId = text(row, "project_id");
  const sourceEventId = text(row, "source_event_id");
  const deliberationId = text(row, "deliberation_id");
  const requestHash = text(row, "request_hash");
  const principalHash = text(row, "principal_hash");
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
  const failureCode = nullableText(row, "failure_code") as ConversationDeliberationJobFailureCode | null;
  const requestedAtMs = integer(row, "requested_at_ms");
  if (
    !projectIdPattern.test(projectId) || !eventIdPattern.test(sourceEventId) ||
    !deliberationIdPattern.test(deliberationId) || !hashPattern.test(requestHash) ||
    !hashPattern.test(principalHash) || !policyIdPattern.test(policyId) ||
    topic.length < 1 || topic.length > 4_096 ||
    !(new Set(["queued", "leased", "settled", "uncertain"])).has(state) ||
    attemptCount < 0 || attemptCount > 100_000 ||
    (leaseId !== null && !/^cdl_[A-Za-z0-9_-]{32}$/u.test(leaseId)) ||
    (leaseOwner !== null && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(leaseOwner)) ||
    (failureCode !== null && failureCode !== "worker_lease_expired" &&
      failureCode !== "deliberation_execution_uncertain")
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "Conversation 숙의 queue record가 유효하지 않습니다.",
    );
  }
  if (conversationDeliberationMilliseconds(requestedAt, "숙의 요청") !== requestedAtMs) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "Conversation 숙의 queue 요청 시각 좌표가 다릅니다.",
    );
  }
  if (leaseExpiresAt !== null && (
    leaseExpiresAtMs === null ||
    conversationDeliberationMilliseconds(leaseExpiresAt, "숙의 lease 만료") !== leaseExpiresAtMs
  )) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "Conversation 숙의 queue lease 시각 좌표가 다릅니다.",
    );
  }
  if (terminalAt !== null &&
    conversationDeliberationMilliseconds(terminalAt, "숙의 queue 종료") < requestedAtMs) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "Conversation 숙의 queue 종료가 요청보다 빠릅니다.",
    );
  }
  return {
    projectId,
    sourceEventId,
    deliberationId,
    requestHash,
    principalHash,
    policyId,
    topic,
    requestedAt,
    state,
    attemptCount,
    leaseExpiresAt,
    summary: decodeConversationDeliberationSummary(nullableText(row, "summary_json"), deliberationId),
    failureCode,
  };
}
