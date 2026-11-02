import type {
  OperatingActionPlanV1,
  SupervisedArtifactReviewV1,
  SupervisedAssignmentObservationV1,
} from "@lervo/application-contract";
import { operatingContractHash } from "./operating-mandate-admission.js";
import { isSupervisedAssignmentAccepted } from "./supervised-assignment-observation.js";

function exactSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

/** Persisting an existing verdict starts no provider, assignment, worker, or filesystem write. */
export function supervisedArtifactReviewFields(effect: SupervisedArtifactReviewV1) {
  return {
    actionKind: "execute_as_owner" as const,
    effectContract: "work.artifact_review.v1" as const,
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: effect.responsibilityArtifactHash,
    rationaleArtifactHash: effect.rationaleArtifactHash,
    requiredCapabilities: [],
    expectedPaths: [],
    addedWorkers: 0,
    addedAssignments: 0,
    concurrentAttempts: 0,
    attemptNumber: 1,
    // V1 mandates require a positive reservation even for a control effect with no provider call.
    reservedTokens: 1,
  };
}

export function assertSupervisedArtifactReview(
  effect: SupervisedArtifactReviewV1,
  plan: OperatingActionPlanV1,
): void {
  const hash = /^sha256:[a-f0-9]{64}$/u;
  const event = /^evt_[a-f0-9]{32}$/u;
  if (
    Object.keys(effect).length !== 12 ||
    effect.schemaVersion !== 1 ||
    effect.kind !== "work.artifact_review" ||
    !/^asn_[a-f0-9]{24}$/u.test(effect.assignmentId) ||
    !Number.isSafeInteger(effect.assignmentRevision) ||
    effect.assignmentRevision < 1 ||
    !event.test(effect.terminalEventId) ||
    !/^agt_[a-f0-9]{24}$/u.test(effect.reviewerAgentId) ||
    ![effect.responsibilityArtifactHash, effect.acceptanceHash, effect.rationaleArtifactHash].every(
      (value) => hash.test(value),
    ) ||
    !["accepted", "rework", "blocked"].includes(effect.verdict) ||
    !Array.isArray(effect.artifactHashes) ||
    effect.artifactHashes.length === 0 ||
    effect.artifactHashes.length > 64 ||
    new Set(effect.artifactHashes).size !== effect.artifactHashes.length ||
    !effect.artifactHashes.every((value) => hash.test(value)) ||
    !Array.isArray(effect.verificationEventIds) ||
    effect.verificationEventIds.length > 64 ||
    new Set(effect.verificationEventIds).size !== effect.verificationEventIds.length ||
    !effect.verificationEventIds.every((value) => event.test(value)) ||
    plan.actionKind !== "execute_as_owner" ||
    plan.effectContract !== "work.artifact_review.v1" ||
    plan.effectHash !== operatingContractHash(effect) ||
    plan.responsibilityArtifactHash !== effect.responsibilityArtifactHash ||
    plan.rationaleArtifactHash !== effect.rationaleArtifactHash ||
    plan.ownerAgentId !== effect.reviewerAgentId
  )
    throw new TypeError("The owner review differs from its exact decision contract.");
}

/** Validates the evidence boundary, not the semantic correctness of the owner's judgement. */
export function assertSupervisedReviewBasis(
  effect: SupervisedArtifactReviewV1,
  assignment: SupervisedAssignmentObservationV1,
): void {
  if (
    assignment.assignmentId !== effect.assignmentId ||
    assignment.revision !== effect.assignmentRevision ||
    assignment.responsibilityArtifactHash !== effect.responsibilityArtifactHash ||
    assignment.terminalEventId !== effect.terminalEventId ||
    assignment.acceptanceOwnerAgentId !== effect.reviewerAgentId ||
    assignment.acceptanceHash !== effect.acceptanceHash ||
    assignment.effectDisposition !== "reconciled" ||
    !exactSet(assignment.artifactHashes, effect.artifactHashes) ||
    effect.verificationEventIds.some(
      (id) => !assignment.verification.some((verification) => verification.eventId === id),
    ) ||
    (effect.verdict === "accepted" &&
      !isSupervisedAssignmentAccepted({ ...assignment, review: effect }))
  )
    throw new Error("The owner review has stale or insufficient task evidence.");
}

export function supervisedArtifactReviewPayload(
  effect: SupervisedArtifactReviewV1,
  plan: OperatingActionPlanV1,
  workstreamRevision: number,
  decisionEventId: string,
) {
  assertSupervisedArtifactReview(effect, plan);
  return {
    schemaVersion: 1,
    projectId: plan.projectId,
    workstreamId: plan.workstreamId,
    workstreamRevision,
    supervisionId: plan.supervisionId,
    ownerAgentId: plan.ownerAgentId,
    mandateHash: plan.mandateHash,
    causationEventIds: [decisionEventId, effect.terminalEventId],
    assignmentIds: [effect.assignmentId],
    artifactHashes: [...effect.artifactHashes],
    verificationEventIds: [...effect.verificationEventIds],
    acceptanceHash: effect.acceptanceHash,
    reviewerAgentId: effect.reviewerAgentId,
    verdict: effect.verdict,
  };
}
