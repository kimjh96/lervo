import { isAssignmentRecoveryCoordinate } from "./supervised-assignment-recovery.js";
import type { SupervisedManagedExecution } from "@lervo/application-contract";
import { assertWorkResponsibility, operatingInteger } from "./operating-contract-validation.js";
import { operatingContractHash } from "./operating-mandate-admission.js";

export function supervisedManagedExecutionFields(effect: SupervisedManagedExecution) {
  assertWorkResponsibility(effect.responsibility);
  if (
    ![1, 2].includes(effect.schemaVersion) ||
    Object.keys(effect).length !== (effect.schemaVersion === 1 ? 8 : 10) ||
    (effect.schemaVersion === 2 &&
      (!isAssignmentRecoveryCoordinate(effect.recovery) ||
        !/^wrk_[a-f0-9]{24}$/u.test(effect.workId) ||
        effect.responsibility.predecessorBindingHash !== effect.recovery.responsibilityHash)) ||
    effect.kind !== "work.managed_execution" ||
    !/^lse_[a-f0-9]{24}$/u.test(effect.leaseId) ||
    !["codex", "claude"].includes(effect.provider) ||
    !["low", "medium", "high"].includes(effect.risk) ||
    typeof effect.instructions !== "string" ||
    effect.instructions.trim().length === 0 ||
    Buffer.byteLength(effect.instructions, "utf8") > 131072 ||
    !operatingInteger(effect.reservedTokens, 1)
  )
    throw new TypeError("The supervised managed execution payload is invalid.");
  const task = effect.responsibility;
  return {
    actionKind: "dispatch" as const,
    effectContract:
      effect.schemaVersion === 1 ? "work.managed_execution.v1" : "work.managed_execution.v2",
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: operatingContractHash(task),
    roleId: task.roleId,
    requiredCapabilities: [...task.requiredCapabilities],
    expectedPaths: [...task.expectedPaths],
    provider: effect.provider,
    addedWorkers: 0,
    addedAssignments: 0,
    concurrentAttempts: 1,
    attemptNumber: effect.schemaVersion === 1 ? 1 : effect.recovery.attemptNumber,
    reservedTokens: effect.reservedTokens,
    deadline: task.completionDeadline,
  };
}

export function supervisedManagedRetryCausality(
  effect: SupervisedManagedExecution,
  workstreamId: string,
) {
  if (effect.schemaVersion === 1) return undefined;
  return {
    relationship: "retry" as const,
    workId: effect.workId,
    parentRunId: effect.recovery.sourceRunId,
    retryOfRunId: effect.recovery.sourceRunId,
    attemptOrdinal: effect.recovery.attemptNumber,
    workstreamId,
    assignmentId: effect.responsibility.assignmentId,
    agentId: effect.responsibility.executorAgentId,
  };
}
