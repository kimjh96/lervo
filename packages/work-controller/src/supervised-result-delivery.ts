import type { OperatingActionPlanV1, SupervisedResultDelivery } from "@lervo/application-contract";
import { operatingContractHash } from "./operating-mandate-admission.js";

export function supervisedResultDeliveryFields(effect: SupervisedResultDelivery) {
  if (
    (effect.schemaVersion === 1
      ? Object.keys(effect).length !== 10
      : effect.schemaVersion !== 2 ||
        Object.keys(effect).length !== 12 ||
        ![effect.reasoningPlanHash, effect.reasoningResultHash].every((hash) =>
          /^sha256:[a-f0-9]{64}$/u.test(hash),
        )) ||
    effect.kind !== "work.result_delivery" ||
    !/^wks_[a-f0-9]{24}$/u.test(effect.workstreamId) ||
    !/^agt_[a-f0-9]{24}$/u.test(effect.ownerAgentId) ||
    !/^evt_[a-f0-9]{32}$/u.test(effect.completionEventId) ||
    ![
      effect.completionPlanHash,
      effect.resultArtifactHash,
      effect.candidateArtifactHash,
      effect.outboundArtifactHash,
      effect.rationaleArtifactHash,
    ].every((hash) => /^sha256:[a-f0-9]{64}$/u.test(hash))
  )
    throw new TypeError("The result delivery effect is invalid.");
  return {
    actionKind: "publish_result" as const,
    effectContract:
      effect.schemaVersion === 1
        ? ("work.result_delivery.v1" as const)
        : ("work.result_delivery.v2" as const),
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: effect.completionPlanHash,
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

export function assertSupervisedResultDelivery(
  effect: SupervisedResultDelivery,
  plan: OperatingActionPlanV1,
) {
  const fields = supervisedResultDeliveryFields(effect);
  if (
    effect.workstreamId !== plan.workstreamId ||
    effect.ownerAgentId !== plan.ownerAgentId ||
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    )
  )
    throw new Error("The result delivery differs from its exact owner decision.");
}
