import type {
  OperatingActionPlanV1,
  SupervisedGoalCompletionV1,
} from "@lervo/application-contract";
import { operatingContractHash } from "./operating-mandate-admission.js";
import { operatingTime } from "./operating-contract-validation.js";

export function supervisedGoalCompletionFields(effect: SupervisedGoalCompletionV1) {
  const hash = /^sha256:[a-f0-9]{64}$/u;
  if (
    Object.keys(effect).length !== 10 ||
    effect.schemaVersion !== 1 ||
    effect.kind !== "work.goal_completion" ||
    !/^wks_[a-f0-9]{24}$/u.test(effect.workstreamId) ||
    !/^agt_[a-f0-9]{24}$/u.test(effect.ownerAgentId) ||
    !Number.isSafeInteger(effect.workstreamRevision) ||
    effect.workstreamRevision < 1 ||
    ![effect.workstreamSnapshotHash, effect.resultArtifactHash, effect.rationaleArtifactHash].every(
      (value) => hash.test(value),
    ) ||
    !operatingTime(effect.completedAt) ||
    !Array.isArray(effect.assignmentReviews) ||
    effect.assignmentReviews.length === 0 ||
    effect.assignmentReviews.length > 256 ||
    new Set(effect.assignmentReviews.map((item) => item.assignmentId)).size !==
      effect.assignmentReviews.length ||
    effect.assignmentReviews.some(
      (item) =>
        Object.keys(item).length !== 3 ||
        !/^asn_[a-f0-9]{24}$/u.test(item.assignmentId) ||
        !Number.isSafeInteger(item.assignmentRevision) ||
        item.assignmentRevision < 1 ||
        !/^evt_[a-f0-9]{32}$/u.test(item.reviewEventId),
    )
  )
    throw new TypeError("The exact goal completion effect is invalid.");
  return {
    actionKind: "execute_as_owner" as const,
    effectContract: "work.goal_completion.v1" as const,
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: effect.workstreamSnapshotHash,
    rationaleArtifactHash: effect.rationaleArtifactHash,
    requiredCapabilities: [],
    expectedPaths: [],
    addedWorkers: 0,
    addedAssignments: 0,
    concurrentAttempts: 0,
    attemptNumber: 1,
    reservedTokens: 1,
  };
}

export function assertSupervisedGoalCompletion(
  effect: SupervisedGoalCompletionV1,
  plan: OperatingActionPlanV1,
) {
  const fields = supervisedGoalCompletionFields(effect);
  if (
    plan.workstreamId !== effect.workstreamId ||
    plan.ownerAgentId !== effect.ownerAgentId ||
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    )
  )
    throw new Error("The goal completion differs from its exact owner decision.");
}
