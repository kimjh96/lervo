import type {
  OperatingActionPlanV1,
  OperatingAdmissionSnapshotV1,
  OperatingMandate,
  SupervisionResourceBudgetV1,
} from "@lervo/application-contract";

/** Projects exact admission counters without reinterpreting provider tokens as price or quota. */
export function observeSupervisionResourceBudget(input: {
  mandate: OperatingMandate;
  plan: OperatingActionPlanV1;
  admission: Pick<
    OperatingAdmissionSnapshotV1,
    "observedAggregateTokens" | "reservedAggregateTokens"
  >;
}): SupervisionResourceBudgetV1 | null {
  if (
    input.mandate.schemaVersion === 3 &&
    input.mandate.aggregateTokenPolicy?.mode === "per_attempt_only"
  )
    return null;
  const observedTokens = input.admission.observedAggregateTokens;
  const reservedTokens = input.admission.reservedAggregateTokens;
  if (observedTokens === null || reservedTokens === null) return null;
  return {
    schemaVersion: 1,
    scope: input.mandate.schemaVersion === 3 ? "goal" : "workstream",
    limitTokens: input.mandate.maximumAggregateTokens,
    observedTokens,
    reservedTokens,
    requestedTokens: input.plan.reservedTokens,
    remainingTokens: Math.max(
      0,
      input.mandate.maximumAggregateTokens - observedTokens - reservedTokens,
    ),
  };
}
