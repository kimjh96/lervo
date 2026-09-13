import type { SupervisedOwnerAttentionV1 } from "@lervo/application-contract";
import { operatingContractHash } from "./operating-mandate-admission.js";
import { operatingHashPattern, operatingTime } from "./operating-contract-validation.js";

export function supervisedOwnerAttentionFields(
  effect: SupervisedOwnerAttentionV1,
  roleId: string,
  provider: string,
) {
  if (
    effect === null ||
    typeof effect !== "object" ||
    Object.keys(effect).length !== 6 ||
    effect.schemaVersion !== 1 ||
    effect.kind !== "work.owner_attention" ||
    !operatingHashPattern.test(effect.basisHash) ||
    !operatingHashPattern.test(effect.rationaleArtifactHash) ||
    !/^[a-z][a-z0-9_]{0,63}$/u.test(effect.reasonCode) ||
    !operatingTime(effect.deadline)
  )
    throw new Error(
      "The owner attention must bind an exact task basis and bounded decision reason.",
    );
  return {
    actionKind: "escalate" as const,
    effectContract: "work.owner_attention.v1" as const,
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: effect.basisHash,
    roleId,
    provider,
    requiredCapabilities: [],
    expectedPaths: [],
    addedWorkers: 0,
    addedAssignments: 0,
    concurrentAttempts: 0,
    attemptNumber: 1,
    reservedTokens: 1,
    deadline: effect.deadline,
  };
}
