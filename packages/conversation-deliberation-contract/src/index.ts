import { createHash } from "node:crypto";

export type ConversationDeliberationStatus =
  "running" | "unknown" | "interrupted" | "converged" | "no_consensus" | "failed";

export interface ConversationDeliberationSummary {
  deliberationId: string;
  status: ConversationDeliberationStatus;
  artifactCount: number;
  nextAction: "wait" | "resume" | "none";
  /** Canonical terminal failure code when the source can prove one; absent for legacy records. */
  failureReasonCode?: string | null;
}

export type ConversationDeliberationJobState = "queued" | "leased" | "settled" | "uncertain";
export type ConversationDeliberationJobFailureCode =
  "worker_lease_expired" | "deliberation_execution_uncertain";
export type ConversationDeliberationResumeJobFailureCode =
  "resume_worker_lease_expired" | "deliberation_resume_execution_uncertain";

export type ConversationDeliberationNotificationOperation = "start" | "resume";
export type ConversationDeliberationNotificationState = "pending" | "leased" | "accepted";

export interface ConversationDeliberationNotification {
  operation: ConversationDeliberationNotificationOperation;
  projectId: string;
  deliberationId: string;
  summary: ConversationDeliberationSummary;
  occurredAt: string;
  state: ConversationDeliberationNotificationState;
  attemptCount: number;
  leaseExpiresAt: string | null;
  conversationEventId: string | null;
  acceptedAt: string | null;
}

export interface ConversationDeliberationNotificationStore {
  claimNotification(input: {
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): Promise<{ leaseId: string; notification: ConversationDeliberationNotification } | null>;
  acceptNotification(input: {
    deliberationId: string;
    leaseId: string;
    conversationEventId: string;
    acceptedAt: string;
  }): Promise<void>;
}

export interface ConversationDeliberationReconciliationRecord<TFailureCode extends string> {
  sourceKind: string;
  evidenceHash: string;
  priorFailureCode: TFailureCode;
  uncertainAt: string;
  reconciledAt: string;
}

export type ConversationDeliberationJobReconciliation =
  ConversationDeliberationReconciliationRecord<ConversationDeliberationJobFailureCode>;
export type ConversationDeliberationResumeJobReconciliation =
  ConversationDeliberationReconciliationRecord<ConversationDeliberationResumeJobFailureCode>;

export interface ConversationDeliberationReconciliationTarget {
  operation: "start" | "resume";
  projectId: string;
  deliberationId: string;
  requestHash: string;
  state: ConversationDeliberationJobState;
  summary: ConversationDeliberationSummary | null;
}

export interface ConversationDeliberationUncertainty {
  deliberationId: string;
  uncertainAt: string;
}

export interface ConversationDeliberationOriginBinding {
  conversationId: string;
  threadId: string | null;
  requesterParticipantId: string;
  originBindingDigest: string;
}

export interface ConversationDeliberationOriginReference extends ConversationDeliberationOriginBinding {
  sourceEventId: string;
  responseLanguage: "en" | "ko";
}

export function calculateConversationDeliberationOriginBindingDigest(input: {
  projectId: string;
  sourceEventId: string;
  conversationId: string;
  threadId: string | null;
  requesterParticipantId: string;
}): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify([
        "conversation-deliberation-origin",
        1,
        input.projectId,
        input.sourceEventId,
        input.conversationId,
        input.threadId,
        input.requesterParticipantId,
      ]),
    )
    .digest("hex")}`;
}

interface ConversationDeliberationJobBase {
  projectId: string;
  sourceEventId: string;
  deliberationId: string;
  requestHash: string;
  principalHash: string;
  requestedAt: string;
  state: ConversationDeliberationJobState;
  attemptCount: number;
  leaseExpiresAt: string | null;
  summary: ConversationDeliberationSummary | null;
}

export interface ConversationDeliberationJob extends ConversationDeliberationJobBase {
  operation: "start";
  origin: ConversationDeliberationOriginBinding | null;
  policyId: string;
  topic: string;
  failureCode: ConversationDeliberationJobFailureCode | null;
  reconciliation: ConversationDeliberationJobReconciliation | null;
}

export interface ConversationDeliberationResumeJob extends ConversationDeliberationJobBase {
  operation: "resume";
  failureCode: ConversationDeliberationResumeJobFailureCode | null;
  reconciliation: ConversationDeliberationResumeJobReconciliation | null;
}

export interface ConversationDeliberationReconciliationStore {
  listUncertain(input: {
    projectId: string;
    limit: number;
  }): Promise<ConversationDeliberationUncertainty[]>;
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

export interface ConversationDeliberationJobStore
  extends ConversationDeliberationReconciliationStore, ConversationDeliberationNotificationStore {
  enqueue(
    input: Omit<
      ConversationDeliberationJob,
      | "operation"
      | "state"
      | "attemptCount"
      | "leaseExpiresAt"
      | "summary"
      | "failureCode"
      | "reconciliation"
      | "origin"
    > & { origin: ConversationDeliberationOriginBinding },
  ): Promise<ConversationDeliberationJob>;
  inspect(input: {
    projectId: string;
    deliberationId: string;
  }): Promise<ConversationDeliberationJob | null>;
  claim(input: {
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): Promise<{ leaseId: string; job: ConversationDeliberationJob } | null>;
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

export interface ConversationDeliberationResumeJobStore
  extends ConversationDeliberationReconciliationStore, ConversationDeliberationNotificationStore {
  enqueue(
    input: Omit<
      ConversationDeliberationResumeJob,
      | "operation"
      | "state"
      | "attemptCount"
      | "leaseExpiresAt"
      | "summary"
      | "failureCode"
      | "reconciliation"
    >,
  ): Promise<ConversationDeliberationResumeJob>;
  inspect(input: {
    projectId: string;
    deliberationId: string;
  }): Promise<ConversationDeliberationResumeJob | null>;
  claim(input: {
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): Promise<{ leaseId: string; job: ConversationDeliberationResumeJob } | null>;
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
    failureCode: ConversationDeliberationResumeJobFailureCode;
  }): Promise<void>;
}

export interface ConversationDeliberationExecutionPort {
  execute(job: Readonly<ConversationDeliberationJob>): Promise<ConversationDeliberationSummary>;
}

export interface ConversationDeliberationResumeExecutionPort {
  execute(
    job: Readonly<ConversationDeliberationResumeJob>,
  ): Promise<ConversationDeliberationSummary>;
}

export const conversationDeliberationPatterns = {
  projectId: /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u,
  sourceEventId: /^cve_[a-f0-9]{64}$/u,
  deliberationId: /^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u,
  policyId: /^deliberation_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u,
  conversationId: /^cnv_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u,
  threadId: /^thd_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u,
  participantId: /^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u,
  workerId: /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u,
  reconciliationSourceKind: /^(?=.{1,64}$)[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/u,
} as const;
