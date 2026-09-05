import type {
  GovernedLoopActionV1,
  GovernedLoopPolicyV1,
  GovernedTokenMetricV1,
  ManagedExecutionBudgetAssessmentV1,
  ManagedStageGroupObservationV1,
  ResourceGroupObservationV1,
} from "@lervo/application-contract";

function observedTokenMetric(
  resource: ResourceGroupObservationV1,
  metric: GovernedTokenMetricV1,
): number | null {
  if (resource.completeness !== "complete" || resource.tokenUsage === null) return null;
  const fields = {
    total_tokens: resource.tokenUsage.totalTokens,
    input_tokens: resource.tokenUsage.inputTokens,
    cached_input_tokens: resource.tokenUsage.cachedInputTokens,
    output_tokens: resource.tokenUsage.outputTokens,
    reasoning_output_tokens: resource.tokenUsage.reasoningOutputTokens,
  } satisfies Record<GovernedTokenMetricV1, number>;
  return fields[metric];
}

function thresholdState(observed: number | null, limit: number) {
  return observed === null ? "unknown" : observed >= limit ? "reached" : "below";
}

export function assessManagedExecutionBudgets(input: {
  resources: readonly ResourceGroupObservationV1[];
  stages: readonly ManagedStageGroupObservationV1[];
  policy: GovernedLoopPolicyV1;
}): ManagedExecutionBudgetAssessmentV1[] {
  const tokenLimits = [
    ...input.policy.tokenLimits.map((limit) => ({
      ...limit,
      metric: "total_tokens" as const,
      stopAfterObservedTokens: limit.stopAfterObservedTotalTokens,
    })),
    ...input.policy.tokenMetricLimits,
  ];
  const tokenAssessments = tokenLimits.map<ManagedExecutionBudgetAssessmentV1>((limit) => {
    const matches = input.resources.filter(
      (resource) =>
        resource.provider === limit.provider &&
        (limit.scope === undefined || resource.scope === limit.scope) &&
        resource.accountingDescriptorHash === limit.accountingDescriptorHash,
    );
    const resource = matches.length === 1 ? matches[0] : undefined;
    const metric = limit.metric;
    const observed = resource === undefined ? null : observedTokenMetric(resource, metric);
    return {
      schemaVersion: 1,
      kind: "token",
      provider: limit.provider,
      scope: limit.scope ?? null,
      accountingDescriptorHash: limit.accountingDescriptorHash,
      metric,
      limitTokens: limit.stopAfterObservedTokens,
      observedTokens: observed,
      remainingObservedTokens:
        observed === null ? null : Math.max(0, limit.stopAfterObservedTokens - observed),
      completeness: resource?.completeness ?? "unobserved",
      thresholdState: thresholdState(observed, limit.stopAfterObservedTokens),
    };
  });
  const durationAssessments = input.policy.durationLimits.map<ManagedExecutionBudgetAssessmentV1>(
    (limit) => {
      const matches = input.stages.filter(
        (stage) =>
          stage.provider === limit.provider &&
          stage.scope === limit.scope &&
          stage.stageId === limit.stageId,
      );
      const stage = matches.length === 1 ? matches[0] : undefined;
      const maximumObserved =
        stage?.completeness === "complete" && stage.observations.length > 0
          ? Math.max(...stage.observations.map((observation) => observation.durationMs))
          : null;
      return {
        schemaVersion: 1,
        kind: "duration",
        provider: limit.provider,
        scope: limit.scope,
        stageId: limit.stageId,
        limitDurationMs: limit.stopAfterObservedDurationMs,
        maximumObservedDurationMs: maximumObserved,
        remainingObservedDurationMs:
          maximumObserved === null
            ? null
            : Math.max(0, limit.stopAfterObservedDurationMs - maximumObserved),
        observationCount: stage?.observations.length ?? 0,
        completeness: stage?.completeness ?? "unobserved",
        thresholdState: thresholdState(maximumObserved, limit.stopAfterObservedDurationMs),
      };
    },
  );
  return [...tokenAssessments, ...durationAssessments];
}

export function managedExecutionBudgetAction(input: {
  assessments: readonly ManagedExecutionBudgetAssessmentV1[];
  policy: GovernedLoopPolicyV1;
}): GovernedLoopActionV1 | null {
  const reached = input.assessments.find((assessment) => assessment.thresholdState === "reached");
  if (reached !== undefined) {
    return {
      kind: input.policy.exhaustedResourceAction,
      assignmentId: null,
      reasonCode: reached.kind === "token" ? "token_budget_exhausted" : "duration_budget_exhausted",
    };
  }
  if (input.assessments.some((assessment) => assessment.thresholdState === "unknown")) {
    return {
      kind: input.policy.unobservedResourceAction,
      assignmentId: null,
      reasonCode: "budget_observation_unavailable",
    };
  }
  return null;
}
