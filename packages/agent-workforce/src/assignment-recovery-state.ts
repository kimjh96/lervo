import { operatingContractHash, isAssignmentRecoveryCoordinate } from "@lervo/work-controller";
import type { WorkforceAssignment, WorkforceAssignmentRecovery } from "./types.js";

/** Caller supplies observed terminal/review evidence; this predicate preserves state lineage. */
export function assignmentRecoveryMatches(
  assignment: WorkforceAssignment,
  recovery: WorkforceAssignmentRecovery,
  settledLeaseId?: string,
): boolean {
  const returnedLease =
    settledLeaseId !== undefined &&
    assignment.status === "leased" &&
    assignment.lease !== null &&
    assignment.lease.leaseId === settledLeaseId &&
    assignment.lease.generation === recovery.predecessorLeaseGeneration;
  return (
    isAssignmentRecoveryCoordinate(recovery) &&
    (returnedLease ||
      (settledLeaseId === undefined &&
        assignment.status === (recovery.kind === "rework" ? "completed" : "failed") &&
        assignment.lease === null)) &&
    assignment.assigneeAgentId !== null &&
    operatingContractHash(assignment) === recovery.predecessorAssignmentHash &&
    recovery.attemptNumber === (assignment.recovery?.attemptNumber ?? 1) + 1 &&
    (returnedLease || assignment.lastLeaseGeneration === recovery.predecessorLeaseGeneration)
  );
}
