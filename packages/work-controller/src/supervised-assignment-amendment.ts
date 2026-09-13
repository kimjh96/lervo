import type {
  AssignmentAmendmentCoordinateV1,
  SupervisedAssignmentAmendmentV1,
} from "@lervo/application-contract";
import { assertWorkResponsibility, operatingHashPattern } from "./operating-contract-validation.js";
import { operatingContractHash } from "./operating-mandate-admission.js";

export function isAssignmentAmendmentCoordinate(
  value: unknown,
): value is AssignmentAmendmentCoordinateV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as AssignmentAmendmentCoordinateV1;
  return (
    Object.keys(item).length === 3 &&
    [
      item.predecessorAssignmentHash,
      item.predecessorResponsibilityHash,
      item.successorResponsibilityHash,
    ].every((hash) => typeof hash === "string" && operatingHashPattern.test(hash))
  );
}

export function supervisedAssignmentAmendmentFields(effect: SupervisedAssignmentAmendmentV1) {
  assertWorkResponsibility(effect.responsibility);
  if (
    Object.keys(effect).length !== 7 ||
    effect.schemaVersion !== 1 ||
    effect.kind !== "work.assignment_amendment" ||
    !["codex", "claude"].includes(effect.provider) ||
    ![
      effect.expectedAssignmentHash,
      effect.predecessorBindingHash,
      effect.rationaleArtifactHash,
    ].every((hash) => typeof hash === "string" && operatingHashPattern.test(hash)) ||
    effect.responsibility.predecessorBindingHash !== effect.predecessorBindingHash
  )
    throw new Error("The supervised assignment amendment is invalid.");
  const task = effect.responsibility;
  return {
    actionKind: "revise_responsibility" as const,
    effectContract: "work.assignment_amendment.v1",
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: operatingContractHash(task),
    roleId: task.roleId,
    requiredCapabilities: [...task.requiredCapabilities],
    expectedPaths: [...task.expectedPaths],
    provider: effect.provider,
    addedWorkers: 0,
    addedAssignments: 0,
    concurrentAttempts: 0,
    attemptNumber: 1,
    reservedTokens: 1,
    deadline: task.startDeadline,
  };
}
