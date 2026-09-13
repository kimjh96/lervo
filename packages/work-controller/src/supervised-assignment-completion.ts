import type { SupervisedAssignmentCompletion } from "@lervo/application-contract";
import { assertWorkResponsibility } from "./operating-contract-validation.js";
import { operatingContractHash } from "./operating-mandate-admission.js";

export function supervisedAssignmentCompletionFields(effect: SupervisedAssignmentCompletion) {
  assertWorkResponsibility(effect.responsibility);
  if (
    Object.keys(effect).length !== (effect.schemaVersion === 2 ? 10 : 9) ||
    ![1, 2].includes(effect.schemaVersion) ||
    effect.kind !== "work.assignment_completion" ||
    ![
      effect.expectedAssignmentHash,
      effect.writingArtifactHash,
      effect.reasoningPlanHash,
      effect.reasoningResultHash,
      effect.rationaleArtifactHash,
      ...(effect.schemaVersion === 2 ? [effect.roleEvaluationArtifactHash] : []),
    ].every((hash) => /^sha256:[a-f0-9]{64}$/u.test(hash)) ||
    !Number.isFinite(Date.parse(effect.preparedAt))
  )
    throw new TypeError("The supervised assignment completion is invalid.");
  const task = effect.responsibility;
  return {
    actionKind: "execute_as_owner" as const,
    effectContract:
      effect.schemaVersion === 2
        ? ("work.assignment_completion.v2" as const)
        : ("work.assignment_completion.v1" as const),
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: operatingContractHash(task),
    roleId: task.roleId,
    requiredCapabilities: [],
    expectedPaths: [...task.expectedPaths],
    addedWorkers: 0,
    addedAssignments: 0,
    concurrentAttempts: 0,
    attemptNumber: 1,
    reservedTokens: 1,
    deadline: task.completionDeadline,
    rationaleArtifactHash: effect.rationaleArtifactHash,
  };
}
