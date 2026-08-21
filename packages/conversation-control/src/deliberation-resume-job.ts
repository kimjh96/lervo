import type { ConversationDeliberationSummary } from "./types.js";
import type {
  ConversationDeliberationJobState,
  ConversationDeliberationReconciliationRecord,
  ConversationDeliberationReconciliationStore,
} from "./deliberation-job.js";

export type ConversationDeliberationResumeJobFailureCode =
  | "resume_worker_lease_expired"
  | "deliberation_resume_execution_uncertain";

export type ConversationDeliberationResumeJobReconciliation =
  ConversationDeliberationReconciliationRecord<ConversationDeliberationResumeJobFailureCode>;

export interface ConversationDeliberationResumeJob {
  operation: "resume";
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
  failureCode: ConversationDeliberationResumeJobFailureCode | null;
  reconciliation: ConversationDeliberationResumeJobReconciliation | null;
}

export interface ConversationDeliberationResumeJobStore
  extends ConversationDeliberationReconciliationStore {
  enqueue(input: Omit<ConversationDeliberationResumeJob,
    "operation" | "state" | "attemptCount" | "leaseExpiresAt" | "summary" | "failureCode" |
    "reconciliation">
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

export interface ConversationDeliberationResumeExecutionPort {
  execute(job: Readonly<ConversationDeliberationResumeJob>): Promise<ConversationDeliberationSummary>;
}
