import {
  type WorkforceArtifactReference,
  type WorkforceEventRecorder,
  type WorkforceAssignment,
} from "./types.js";
import {
  type AssignmentCompletionReconciliation,
  validAssignmentCompletionReconciliation,
  preparedCompletionMatchesAssignment,
  reconciledCompletionPayload,
} from "./assignment-completion-reconciliation.js";
import { validArtifact, fail } from "./workforce-state-validation.js";
import { readAssignmentState, assignmentPath } from "./assignment-state.js";
import { exactLease } from "./assignment-lease.js";
import { transition, retryConcurrent } from "./workforce-state-io.js";

export async function completeAssignmentOnce(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  resultArtifacts: WorkforceArtifactReference[];
  verificationStatus: "passed" | "failed";
  failureCode?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
  reconciliation?: AssignmentCompletionReconciliation;
}): Promise<WorkforceAssignment> {
  const now = input.now ?? new Date();
  if (
    !Array.isArray(input.resultArtifacts) ||
    input.resultArtifacts.length > 64 ||
    !input.resultArtifacts.every(validArtifact) ||
    (input.verificationStatus === "passed" && input.resultArtifacts.length === 0) ||
    (input.failureCode !== undefined && !/^[a-z][a-z0-9_]{1,99}$/u.test(input.failureCode))
  )
    fail("assignment_invalid", "The assignment result is invalid.");
  if (
    input.reconciliation !== undefined &&
    (!validAssignmentCompletionReconciliation({
      reconciliation: input.reconciliation,
      verificationStatus: input.verificationStatus,
      resultArtifacts: input.resultArtifacts,
    }) ||
      (input.reconciliation.executionCompletedAt !== undefined &&
        Date.parse(input.reconciliation.preparedAt) > now.getTime()))
  ) {
    fail("assignment_invalid", "The assignment completion reconciliation is invalid.");
  }
  const assignmentState = await readAssignmentState(input.repositoryRoot, input.assignmentId);
  const assignment = assignmentState.value;
  if (input.reconciliation === undefined) {
    exactLease(assignment, input.agentId, input.leaseId, now);
  } else {
    if (
      !preparedCompletionMatchesAssignment({
        assignment,
        assignmentRevision: input.reconciliation.assignmentRevision,
        agentId: input.agentId,
        leaseId: input.leaseId,
        preparedAt: input.reconciliation.preparedAt,
        ...(input.reconciliation.executionCompletedAt === undefined
          ? {}
          : { executionCompletedAt: input.reconciliation.executionCompletedAt }),
      })
    ) {
      fail(
        "assignment_lease_conflict",
        "The prepared completion differs from the assignment revision or lease.",
      );
    }
  }
  const status =
    input.verificationStatus === "passed" ? ("completed" as const) : ("failed" as const);
  const next: WorkforceAssignment = {
    ...assignment,
    status,
    lease: null,
    lastLeaseGeneration: assignment.lease!.generation,
    resultArtifacts: [...input.resultArtifacts],
    failureCode: status === "failed" ? (input.failureCode ?? "verification_failed") : null,
    revision: assignment.revision + 1,
    updatedAt: now.toISOString(),
  };
  const target = await assignmentPath(input.repositoryRoot, assignment.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now,
    content: `${JSON.stringify(next, null, 2)}\n`,
    result: structuredClone(next),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    expectedBefore: assignmentState.source,
    event:
      input.reconciliation === undefined
        ? {
            type: "assignment.completed",
            occurredAt: next.updatedAt,
            actorAgentId: input.agentId,
            payload: {
              assignmentId: assignment.assignmentId,
              agentId: input.agentId,
              status,
              verificationStatus: input.verificationStatus,
              artifactIds: next.resultArtifacts.map((item) => item.artifactId),
              artifactHashes: next.resultArtifacts.map((item) => item.contentHash),
              failureCode: next.failureCode,
            },
          }
        : {
            type: "assignment.completion.reconciled",
            occurredAt: next.updatedAt,
            actorAgentId: input.agentId,
            payload: reconciledCompletionPayload({
              reconciliation: input.reconciliation,
              assignmentId: assignment.assignmentId,
              agentId: input.agentId,
              leaseId: input.leaseId,
              resultArtifact: next.resultArtifacts[0]!,
              revision: next.revision,
              reconciledAt: next.updatedAt,
            }),
          },
  });
}

export function completeAssignment(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  resultArtifacts: WorkforceArtifactReference[];
  verificationStatus: "passed" | "failed";
  failureCode?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => completeAssignmentOnce(input));
}

export function reconcileAssignmentCompletion(input: {
  repositoryRoot: string;
  assignmentId: string;
  assignmentRevision: number;
  agentId: string;
  leaseId: string;
  resultArtifact: WorkforceArtifactReference;
  completionEvidenceId: string;
  reconciliationCommandId: string;
  sourceRunId: string;
  preparedAt: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() =>
    completeAssignmentOnce({
      repositoryRoot: input.repositoryRoot,
      assignmentId: input.assignmentId,
      agentId: input.agentId,
      leaseId: input.leaseId,
      resultArtifacts: [input.resultArtifact],
      verificationStatus: "passed",
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
      reconciliation: {
        completionEvidenceId: input.completionEvidenceId,
        reconciliationCommandId: input.reconciliationCommandId,
        sourceRunId: input.sourceRunId,
        assignmentRevision: input.assignmentRevision,
        preparedAt: input.preparedAt,
      },
    }),
  );
}
