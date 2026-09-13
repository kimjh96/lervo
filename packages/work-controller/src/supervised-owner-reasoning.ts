import type {
  OperatingActionPlanV1,
  SupervisedOwnerReasoningV1,
} from "@lervo/application-contract";
import {
  operatingHashPattern,
  operatingInteger,
  operatingTime,
} from "./operating-contract-validation.js";
import { operatingContractHash } from "./operating-mandate-admission.js";

export function supervisedOwnerReasoningFields(effect: SupervisedOwnerReasoningV1) {
  if (
    Object.keys(effect).length !== 12 ||
    effect.schemaVersion !== 1 ||
    effect.kind !== "work.owner_reasoning" ||
    ![effect.basisHash, effect.contextArtifactHash, effect.roleContractHash].every((value) =>
      operatingHashPattern.test(value),
    ) ||
    !/^[a-z][a-z0-9-]{0,63}$/u.test(effect.roleId) ||
    !/^\d+\.\d+\.\d+$/u.test(effect.roleVersion) ||
    !["codex", "claude"].includes(effect.provider) ||
    (effect.requestedModel !== null &&
      (typeof effect.requestedModel !== "string" ||
        effect.requestedModel.length < 1 ||
        effect.requestedModel.length > 128 ||
        /[\r\n\0]/u.test(effect.requestedModel))) ||
    !operatingInteger(effect.reservedTokens, 1) ||
    !operatingInteger(effect.attemptNumber, 1) ||
    effect.attemptNumber > 3 ||
    !operatingTime(effect.deadline)
  )
    throw new Error("The owner reasoning effect is invalid.");
  return {
    actionKind: "execute_as_owner" as const,
    effectContract: "work.owner_reasoning.v1" as const,
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: effect.basisHash,
    roleId: effect.roleId,
    requiredCapabilities: ["filesystem.read"],
    expectedPaths: [],
    provider: effect.provider,
    addedWorkers: 0,
    addedAssignments: 0,
    concurrentAttempts: 1,
    attemptNumber: effect.attemptNumber,
    reservedTokens: effect.reservedTokens,
    deadline: effect.deadline,
  } satisfies Partial<OperatingActionPlanV1>;
}
