import type { SupervisedAssignmentAmendmentV1 } from "@lervo/application-contract";
import {
  evaluateResponsibilityClaimScope,
  operatingContractHash,
  supervisedAssignmentAmendmentFields,
} from "@lervo/work-controller";
import type { WorkforceAssignment } from "./types.js";

/** An amendment changes unstarted criteria, verification and narrowed paths before a separate claim. */
export function amendedAssignment(
  previous: WorkforceAssignment,
  effect: SupervisedAssignmentAmendmentV1,
  occurredAt: string,
): WorkforceAssignment {
  supervisedAssignmentAmendmentFields(effect);
  const task = effect.responsibility;
  if (
    !Number.isFinite(Date.parse(occurredAt)) ||
    operatingContractHash(previous) !== effect.expectedAssignmentHash ||
    !["queued", "leased"].includes(previous.status) ||
    (previous.lease !== null && Date.parse(previous.lease.expiresAt) > Date.parse(occurredAt)) ||
    previous.recovery !== undefined ||
    previous.resultArtifacts.length !== 0 ||
    previous.handoffs.length !== 0 ||
    evaluateResponsibilityClaimScope(
      {
        ...previous,
        revision: previous.revision + 1,
        acceptanceCriteria: task.acceptanceCriteria,
        verificationSuiteIds: task.verificationSuiteIds,
      },
      task,
    ).length !== 0
  )
    throw new Error("Amendment requires the exact unstarted assignment within its existing scope.");
  return {
    ...previous,
    status: "queued",
    lease: null,
    ...(previous.lease === null ? {} : { lastLeaseGeneration: previous.lease.generation }),
    expectedPaths: [...task.expectedPaths],
    acceptanceCriteria: [...task.acceptanceCriteria],
    verificationSuiteIds: [...task.verificationSuiteIds],
    amendment: {
      predecessorAssignmentHash: effect.expectedAssignmentHash,
      predecessorResponsibilityHash: effect.predecessorBindingHash,
      successorResponsibilityHash: operatingContractHash(task),
    },
    revision: previous.revision + 1,
    updatedAt: occurredAt,
  };
}
