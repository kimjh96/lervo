import type {
  OperatingActionPlanV1,
  SupervisedResponsibilityClaimV1,
} from "@lervo/application-contract";
import { assertWorkResponsibility, operatingHashPattern } from "./operating-contract-validation.js";
import { operatingContractHash } from "./operating-mandate-admission.js";

export function supervisedResponsibilityClaimFields(effect: SupervisedResponsibilityClaimV1) {
  const task = effect.responsibility;
  assertWorkResponsibility(task);
  if (
    Object.keys(effect).length !== 7 ||
    effect.schemaVersion !== 1 ||
    effect.kind !== "work.responsibility_claim" ||
    !operatingHashPattern.test(effect.expectedAssignmentHash) ||
    !operatingHashPattern.test(effect.rationaleArtifactHash) ||
    !["codex", "claude"].includes(effect.provider) ||
    !Number.isSafeInteger(effect.leaseDurationMs) ||
    effect.leaseDurationMs < 5000 ||
    effect.leaseDurationMs > 1800_000 ||
    Buffer.byteLength(JSON.stringify(effect)) > 256 * 1024
  )
    throw new Error("The supervised responsibility claim is invalid.");
  return {
    actionKind:
      task.predecessorBindingHash === null
        ? ("allocate_existing" as const)
        : ("revise_responsibility" as const),
    effectContract: "work.responsibility_claim.v1",
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: operatingContractHash(task),
    rationaleArtifactHash: effect.rationaleArtifactHash,
    roleId: task.roleId,
    requiredCapabilities: [...task.requiredCapabilities],
    expectedPaths: [...task.expectedPaths].sort(),
    provider: effect.provider,
    addedWorkers: 0,
    addedAssignments: 0,
    concurrentAttempts: 0,
    attemptNumber: 1,
    reservedTokens: 1,
    deadline: task.completionDeadline,
  } satisfies Partial<OperatingActionPlanV1>;
}
