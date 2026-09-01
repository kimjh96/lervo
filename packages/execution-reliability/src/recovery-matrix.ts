import {
  projectEffectRecovery,
  type EffectBoundaryContract,
  type EffectRecoveryObservation,
  type EffectRecoveryOutcome,
} from "@lervo/execution-contract";

export interface RecoveryScenarioResult {
  scenarioId: string;
  effectId: string;
  faultPoint:
    | "before_effect"
    | "after_effect_before_evidence"
    | "after_evidence_before_projection"
    | "state_evidence_conflict"
    | "uncertain_external_response";
  expected: EffectRecoveryOutcome;
  observed: EffectRecoveryOutcome;
  status: "passed" | "failed";
}

function scenario(
  contract: EffectBoundaryContract,
  faultPoint: RecoveryScenarioResult["faultPoint"],
  observation: EffectRecoveryObservation,
  expected: EffectRecoveryOutcome,
): RecoveryScenarioResult {
  const observed = projectEffectRecovery(contract, observation);
  return {
    scenarioId: `${contract.effectId}:${faultPoint}`,
    effectId: contract.effectId,
    faultPoint,
    expected,
    observed,
    status: observed === expected ? "passed" : "failed",
  };
}

export function createRecoveryMatrix(
  contracts: readonly EffectBoundaryContract[],
): RecoveryScenarioResult[] {
  return contracts.flatMap((contract) => {
    const externalAbsent =
      contract.effectKind === "external" ? "confirmed_absent" : "not_applicable";
    const externalApplied =
      contract.effectKind === "external" ? "confirmed_applied" : "not_applicable";
    return [
      scenario(
        contract,
        "before_effect",
        { state: "before", successEvidence: "absent", externalObservation: externalAbsent },
        "exact_rollback",
      ),
      scenario(
        contract,
        "after_effect_before_evidence",
        { state: "after", successEvidence: "absent", externalObservation: externalApplied },
        "recovery_required",
      ),
      scenario(
        contract,
        "after_evidence_before_projection",
        { state: "after", successEvidence: "present", externalObservation: externalApplied },
        "exact_completion",
      ),
      scenario(
        contract,
        "state_evidence_conflict",
        { state: "before", successEvidence: "present", externalObservation: externalApplied },
        "recovery_required",
      ),
      scenario(
        contract,
        "uncertain_external_response",
        { state: "unknown", successEvidence: "unknown", externalObservation: "unknown" },
        "recovery_required",
      ),
    ];
  });
}
