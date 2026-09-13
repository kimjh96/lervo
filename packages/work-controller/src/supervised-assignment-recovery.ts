import type {
  AssignmentRecoveryCoordinateV1,
  SupervisedAssignmentRecovery,
} from "@lervo/application-contract";
import { assertWorkResponsibility, operatingHashPattern } from "./operating-contract-validation.js";
import { operatingContractHash } from "./operating-mandate-admission.js";

export function isAssignmentRecoveryCoordinate(
  value: unknown,
): value is AssignmentRecoveryCoordinateV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as AssignmentRecoveryCoordinateV1;
  return (
    Object.keys(item).length === 8 &&
    ["rework", "retry"].includes(item.kind) &&
    /^sha256:[a-f0-9]{64}$/u.test(item.predecessorAssignmentHash) &&
    /^sha256:[a-f0-9]{64}$/u.test(item.responsibilityHash) &&
    /^run_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(item.sourceRunId) &&
    /^evt_[A-Za-z0-9_-]{8,128}$/u.test(item.terminalEventId) &&
    (item.kind === "rework"
      ? /^evt_[A-Za-z0-9_-]{8,128}$/u.test(item.reviewEventId ?? "")
      : item.reviewEventId === null) &&
    Number.isSafeInteger(item.attemptNumber) &&
    item.attemptNumber >= 2 &&
    Number.isSafeInteger(item.predecessorLeaseGeneration) &&
    item.predecessorLeaseGeneration >= 1
  );
}

export function supervisedAssignmentRecoveryFields(effect: SupervisedAssignmentRecovery) {
  assertWorkResponsibility(effect.responsibility);
  if (
    ![1, 2].includes(effect.schemaVersion) ||
    Object.keys(effect).length !== (effect.schemaVersion === 2 ? 7 : 6) ||
    (effect.schemaVersion === 2 && !/^lse_[a-f0-9]{24}$/u.test(effect.settledLeaseId)) ||
    effect.kind !== "work.assignment_recovery" ||
    !isAssignmentRecoveryCoordinate(effect.recovery) ||
    !["codex", "claude"].includes(effect.provider) ||
    !operatingHashPattern.test(effect.rationaleArtifactHash) ||
    effect.responsibility.predecessorBindingHash !== effect.recovery.responsibilityHash
  )
    throw new Error("The supervised assignment recovery is invalid.");
  const task = effect.responsibility;
  return {
    actionKind:
      effect.recovery.kind === "rework" ? ("request_rework" as const) : ("retry_attempt" as const),
    effectContract: `work.assignment_recovery.v${effect.schemaVersion}`,
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: operatingContractHash(task),
    roleId: task.roleId,
    requiredCapabilities: [...task.requiredCapabilities],
    expectedPaths: [...task.expectedPaths],
    provider: effect.provider,
    addedWorkers: 0,
    addedAssignments: 0,
    concurrentAttempts: 0,
    attemptNumber: effect.recovery.attemptNumber,
    reservedTokens: 1,
    deadline: task.startDeadline,
  };
}
