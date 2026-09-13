import type { WorkforceArtifactReference, WorkforceAssignment } from "./types.js";

export interface AssignmentCompletionReconciliation {
  completionEvidenceId: string;
  reconciliationCommandId: string;
  sourceRunId: string;
  assignmentRevision: number;
  preparedAt: string;
  executionCompletedAt?: string;
}

export function validAssignmentCompletionReconciliation(input: {
  reconciliation: AssignmentCompletionReconciliation;
  verificationStatus: "passed" | "failed";
  resultArtifacts: readonly WorkforceArtifactReference[];
}): boolean {
  return (
    /^acp_[a-f0-9]{24}$/u.test(input.reconciliation.completionEvidenceId) &&
    /^gcr_[a-f0-9]{24}$/u.test(input.reconciliation.reconciliationCommandId) &&
    /^run_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(input.reconciliation.sourceRunId) &&
    Number.isSafeInteger(input.reconciliation.assignmentRevision) &&
    input.reconciliation.assignmentRevision >= 1 &&
    !Number.isNaN(Date.parse(input.reconciliation.preparedAt)) &&
    (input.reconciliation.executionCompletedAt === undefined ||
      (Number.isFinite(Date.parse(input.reconciliation.executionCompletedAt)) &&
        Date.parse(input.reconciliation.executionCompletedAt) <=
          Date.parse(input.reconciliation.preparedAt))) &&
    input.verificationStatus === "passed" &&
    input.resultArtifacts.length === 1
  );
}

export function preparedCompletionMatchesAssignment(input: {
  assignment: WorkforceAssignment;
  assignmentRevision: number;
  agentId: string;
  leaseId: string;
  preparedAt: string;
  executionCompletedAt?: string;
}): boolean {
  const lease = input.assignment.lease;
  const preparedAt = Date.parse(input.executionCompletedAt ?? input.preparedAt);
  return (
    input.assignment.revision === input.assignmentRevision &&
    input.assignment.status === "leased" &&
    input.assignment.assigneeAgentId === input.agentId &&
    lease !== null &&
    lease.agentId === input.agentId &&
    lease.leaseId === input.leaseId &&
    preparedAt >= Date.parse(lease.acquiredAt) &&
    preparedAt < Date.parse(lease.expiresAt)
  );
}

export function reconciledCompletionPayload(input: {
  reconciliation: AssignmentCompletionReconciliation;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  resultArtifact: WorkforceArtifactReference;
  revision: number;
  reconciledAt: string;
}): Record<string, string | number> {
  return {
    completionEvidenceId: input.reconciliation.completionEvidenceId,
    reconciliationCommandId: input.reconciliation.reconciliationCommandId,
    sourceRunId: input.reconciliation.sourceRunId,
    assignmentId: input.assignmentId,
    agentId: input.agentId,
    leaseId: input.leaseId,
    resultArtifactId: input.resultArtifact.artifactId,
    resultContentHash: input.resultArtifact.contentHash,
    revision: input.revision,
    reconciledAt: input.reconciledAt,
  };
}
