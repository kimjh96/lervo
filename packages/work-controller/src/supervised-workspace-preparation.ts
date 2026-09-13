import type { SupervisedWorkspacePreparationV1 } from "@lervo/application-contract";
import { assertWorkResponsibility } from "./operating-contract-validation.js";
import { operatingContractHash } from "./operating-mandate-admission.js";

export function supervisedWorkspacePreparationFields(effect: SupervisedWorkspacePreparationV1) {
  assertWorkResponsibility(effect.responsibility);
  if (
    Object.keys(effect).length !== 6 ||
    effect.schemaVersion !== 1 ||
    effect.kind !== "work.workspace_preparation" ||
    !["codex", "claude"].includes(effect.provider) ||
    !/^sha256:[a-f0-9]{64}$/u.test(effect.provisionPlanHash) ||
    !/^sha256:[a-f0-9]{64}$/u.test(effect.rationaleArtifactHash)
  )
    throw new TypeError("The supervised workspace preparation is invalid.");
  const task = effect.responsibility;
  return {
    actionKind: "execute_as_owner" as const,
    effectContract: "work.workspace_preparation.v1" as const,
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: operatingContractHash(task),
    roleId: task.roleId,
    requiredCapabilities: [],
    expectedPaths: [...task.expectedPaths],
    provider: effect.provider,
    addedWorkers: 0,
    addedAssignments: 0,
    concurrentAttempts: 0,
    attemptNumber: 1,
    reservedTokens: 1,
    deadline: task.startDeadline,
    rationaleArtifactHash: effect.rationaleArtifactHash,
  };
}
