import type { ConversationDeliberationSummary } from "./types.js";
import { ConversationControlError } from "./types.js";

export type ConversationDeliberationJobState =
  | "queued"
  | "leased"
  | "settled"
  | "uncertain";

export type ConversationDeliberationJobFailureCode =
  | "worker_lease_expired"
  | "deliberation_execution_uncertain";

export interface ConversationDeliberationReconciliationRecord<TFailureCode extends string> {
  sourceKind: string;
  evidenceHash: string;
  priorFailureCode: TFailureCode;
  uncertainAt: string;
  reconciledAt: string;
}

export type ConversationDeliberationJobReconciliation =
  ConversationDeliberationReconciliationRecord<ConversationDeliberationJobFailureCode>;

export interface ConversationDeliberationReconciliationTarget {
  operation: "start" | "resume";
  projectId: string;
  deliberationId: string;
  requestHash: string;
  state: ConversationDeliberationJobState;
  summary: ConversationDeliberationSummary | null;
}

export interface ConversationDeliberationJob {
  operation: "start";
  projectId: string;
  sourceEventId: string;
  deliberationId: string;
  requestHash: string;
  principalHash: string;
  policyId: string;
  topic: string;
  requestedAt: string;
  state: ConversationDeliberationJobState;
  attemptCount: number;
  leaseExpiresAt: string | null;
  summary: ConversationDeliberationSummary | null;
  failureCode: ConversationDeliberationJobFailureCode | null;
  reconciliation: ConversationDeliberationJobReconciliation | null;
}

export interface ConversationDeliberationJobLease {
  leaseId: string;
  job: ConversationDeliberationJob;
}

export interface ConversationDeliberationReconciliationStore {
  inspect(input: {
    projectId: string;
    deliberationId: string;
  }): Promise<ConversationDeliberationReconciliationTarget | null>;
  reconcile(input: {
    projectId: string;
    deliberationId: string;
    requestHash: string;
    sourceKind: string;
    evidenceHash: string;
    reconciledAt: string;
    summary: ConversationDeliberationSummary;
  }): Promise<void>;
}

export interface ConversationDeliberationJobStore extends ConversationDeliberationReconciliationStore {
  enqueue(input: Omit<ConversationDeliberationJob,
    "operation" | "state" | "attemptCount" | "leaseExpiresAt" | "summary" | "failureCode" |
    "reconciliation">
  ): Promise<ConversationDeliberationJob>;
  inspect(input: {
    projectId: string;
    deliberationId: string;
  }): Promise<ConversationDeliberationJob | null>;
  claim(input: {
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): Promise<ConversationDeliberationJobLease | null>;
  renew(input: {
    deliberationId: string;
    leaseId: string;
    renewedAt: string;
    leaseDurationMs: number;
  }): Promise<void>;
  settle(input: {
    deliberationId: string;
    leaseId: string;
    settledAt: string;
    summary: ConversationDeliberationSummary;
  }): Promise<void>;
  markUncertain(input: {
    deliberationId: string;
    leaseId: string;
    failedAt: string;
    failureCode: ConversationDeliberationJobFailureCode;
  }): Promise<void>;
}

export interface ConversationDeliberationExecutionPort {
  execute(job: Readonly<ConversationDeliberationJob>): Promise<ConversationDeliberationSummary>;
}

export const conversationDeliberationPatterns = {
  projectId: /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u,
  sourceEventId: /^cve_[a-f0-9]{64}$/u,
  deliberationId: /^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u,
  policyId: /^deliberation_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u,
  workerId: /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u,
  reconciliationSourceKind: /^(?=.{1,64}$)[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/u,
} as const;

export function conversationDeliberationTimestamp(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      `${label} 시각이 유효하지 않습니다.`,
    );
  }
  return milliseconds;
}

export function assertConversationDeliberationSummary(
  summary: ConversationDeliberationSummary,
  deliberationId: string,
): void {
  const action = ({
    running: "wait",
    unknown: "none",
    interrupted: "resume",
    converged: "none",
    no_consensus: "none",
    failed: "none",
  } as const)[summary.status];
  if (
    !conversationDeliberationPatterns.deliberationId.test(summary.deliberationId) ||
    summary.deliberationId !== deliberationId ||
    !Number.isSafeInteger(summary.artifactCount) ||
    summary.artifactCount < 0 || summary.artifactCount > 10_000 ||
    action === undefined || summary.nextAction !== action
  ) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      "숙의 실행 결과 좌표가 요청과 일치하지 않습니다.",
    );
  }
}
