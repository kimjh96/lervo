import { operatingContractHash } from "@lervo/work-controller";
import { assignmentRecoveryMatches } from "./assignment-recovery-state.js";
import { assignmentPath, listAssignments, readAssignmentState } from "./assignment-state.js";
import { transition } from "./workforce-state-io.js";
import { fail } from "./workforce-state-validation.js";
import type {
  WorkforceAssignment,
  WorkforceAssignmentRecovery,
  WorkforceEventRecorder,
} from "./types.js";

/** Reopens one exact terminal revision; acquiring a successor lease is a separate effect. */
export async function reopenAssignment(input: {
  repositoryRoot: string;
  assignmentId: string;
  recovery: WorkforceAssignmentRecovery;
  settledLeaseId?: string;
  now: Date;
  recordEvent: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  const current = await readAssignmentState(input.repositoryRoot, input.assignmentId);
  if (!assignmentRecoveryMatches(current.value, input.recovery, input.settledLeaseId))
    fail("assignment_lease_conflict", "Recovery differs from the exact terminal assignment.");
  const next: WorkforceAssignment = {
    ...current.value,
    status: "queued",
    lease: null,
    lastLeaseGeneration: input.recovery.predecessorLeaseGeneration,
    recovery: structuredClone(input.recovery),
    revision: current.value.revision + 1,
    updatedAt: input.now.toISOString(),
  };
  const target = await assignmentPath(input.repositoryRoot, input.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now: input.now,
    content: `${JSON.stringify(next, null, 2)}\n`,
    expectedBefore: current.source,
    result: structuredClone(next),
    recordEvent: input.recordEvent,
    beforeWrite: async () => {
      const assignments = await listAssignments(input.repositoryRoot);
      if (
        assignments.some(
          (assignment) =>
            assignment.dependencyIds.includes(next.assignmentId) &&
            !["queued", "blocked", "cancelled"].includes(assignment.status),
        )
      )
        fail(
          "assignment_dependency_blocked",
          "Recovery must first reconcile dependent work that already consumed the result.",
        );
    },
    event: {
      type: "assignment.reopened",
      occurredAt: next.updatedAt,
      actorAgentId: null,
      payload: {
        assignmentId: next.assignmentId,
        assignmentRevision: next.revision,
        assignmentHash: operatingContractHash(next),
        ...input.recovery,
      },
    },
  });
}
