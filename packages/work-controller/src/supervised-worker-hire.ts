import type { SupervisedWorkerHireV1 } from "@lervo/application-contract";
import { assertWorkResponsibility } from "./operating-contract-validation.js";
import { operatingContractHash } from "./operating-mandate-admission.js";

export function supervisedWorkerHireFields(effect: SupervisedWorkerHireV1) {
  assertWorkResponsibility(effect.requirement);
  if (
    Object.keys(effect).length !== 7 ||
    effect.schemaVersion !== 1 ||
    effect.kind !== "work.worker_hire" ||
    !["codex", "claude"].includes(effect.provider) ||
    typeof effect.displayName !== "string" ||
    effect.displayName.trim() !== effect.displayName ||
    [...effect.displayName].length < 1 ||
    [...effect.displayName].length > 80 ||
    /[\u0000-\u001f\u007f]/u.test(effect.displayName) ||
    ![effect.expectedAgentsHash, effect.rationaleArtifactHash].every((hash) =>
      /^sha256:[a-f0-9]{64}$/u.test(hash),
    ) ||
    effect.requirement.assignmentId !== `asn_${"0".repeat(24)}` ||
    effect.requirement.assignmentRevision !== 2 ||
    effect.requirement.predecessorBindingHash !== null
  )
    throw new TypeError("The bounded supervised hire requirement is invalid.");
  const task = effect.requirement;
  return {
    actionKind: "hire_worker" as const,
    effectContract: "work.worker_hire.v1" as const,
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: operatingContractHash(task),
    roleId: task.roleId,
    requiredCapabilities: [...task.requiredCapabilities],
    expectedPaths: [...task.expectedPaths],
    provider: effect.provider,
    addedWorkers: 1,
    addedAssignments: 0,
    concurrentAttempts: 0,
    attemptNumber: 1,
    reservedTokens: 1,
    deadline: task.startDeadline,
    rationaleArtifactHash: effect.rationaleArtifactHash,
  };
}
