import type {
  AssignmentCompletionEvidenceV1,
  GovernedLoopActionV1,
  GovernedLoopPolicyV1,
  ManagedAttemptObservationV1,
  WorkGraphNodeV1,
} from "@lervo/application-contract";

function disposition(
  kind: "block" | "escalate",
  reasonCode: "attempts_exhausted" | "completion_reconciliation_required",
  assignmentId: string,
): GovernedLoopActionV1 {
  return { kind, reasonCode, assignmentId };
}

function orderedAttempts(
  node: WorkGraphNodeV1,
  attempts: readonly ManagedAttemptObservationV1[],
): ManagedAttemptObservationV1[] {
  return attempts
    .filter((attempt) => attempt.assignmentId === node.assignmentId)
    .sort((left, right) => left.attemptOrdinal - right.attemptOrdinal);
}

export function attemptRequiresDisposition(input: {
  node: WorkGraphNodeV1;
  attempts: readonly ManagedAttemptObservationV1[];
}): boolean {
  const latest = orderedAttempts(input.node, input.attempts).at(-1);
  return (
    latest?.terminalStatus === "in_progress" ||
    (latest?.terminalStatus === "completed" && latest.verificationStatus === "passed")
  );
}

export function decideAssignmentAttempt(input: {
  node: WorkGraphNodeV1;
  attempts: readonly ManagedAttemptObservationV1[];
  policy: GovernedLoopPolicyV1;
  workstreamId: string;
  completionEvidence: readonly AssignmentCompletionEvidenceV1[];
}): GovernedLoopActionV1 {
  const attempts = orderedAttempts(input.node, input.attempts);
  const latest = attempts.at(-1);
  if (latest === undefined) {
    return {
      kind: "start_attempt",
      assignmentId: input.node.assignmentId,
      reasonCode: "ready",
      causality: {
        relationship: "root",
        workstreamId: input.workstreamId,
        assignmentId: input.node.assignmentId,
        agentId: input.node.assigneeAgentId!,
      },
    };
  }
  if (latest.terminalStatus === "in_progress") {
    return { kind: "wait", assignmentId: input.node.assignmentId, reasonCode: "active_attempt" };
  }
  if (latest.terminalStatus === "completed" && latest.verificationStatus === "passed") {
    const evidence = input.completionEvidence.find(
      (candidate) =>
        candidate.assignmentId === input.node.assignmentId && candidate.runId === latest.runId,
    );
    if (
      evidence !== undefined &&
      evidence.workstreamId === input.workstreamId &&
      evidence.assignmentRevision === input.node.assignmentRevision &&
      evidence.agentId === input.node.assigneeAgentId &&
      evidence.leaseId === input.node.leaseId
    ) {
      return {
        kind: "reconcile_completion",
        assignmentId: input.node.assignmentId,
        reasonCode: "completion_evidence_verified",
        completionEvidenceId: evidence.completionEvidenceId,
        runId: evidence.runId,
      };
    }
    return disposition("escalate", "completion_reconciliation_required", input.node.assignmentId);
  }
  if (attempts.length >= input.policy.maxAttemptsPerAssignment) {
    return disposition(
      input.policy.terminalFailureAction,
      "attempts_exhausted",
      input.node.assignmentId,
    );
  }
  return {
    kind: "retry_attempt",
    assignmentId: input.node.assignmentId,
    reasonCode: "attempt_failed",
    causality: {
      relationship: "retry",
      workId: latest.workId,
      parentRunId: latest.runId,
      retryOfRunId: latest.runId,
      attemptOrdinal: latest.attemptOrdinal + 1,
      workstreamId: input.workstreamId,
      assignmentId: input.node.assignmentId,
      agentId: input.node.assigneeAgentId!,
    },
  };
}
