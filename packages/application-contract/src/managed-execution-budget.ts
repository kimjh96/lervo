export const governedResourceScopes = [
  "primary_provider",
  "subagent_provider",
  "query_projection",
  "publication_evaluation",
  "deliberation",
  "improvement_evaluation",
] as const;

export type GovernedResourceScopeV1 = (typeof governedResourceScopes)[number];

export const governedTokenDimensionMetrics = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
] as const;

export const governedTokenMetrics = ["total_tokens", ...governedTokenDimensionMetrics] as const;

export type GovernedTokenMetricV1 = (typeof governedTokenMetrics)[number];

export const managedExecutionStages = [
  "repository_snapshot",
  "provider_start",
  "corpus_preparation",
  "context_injection",
  "provider_turn",
  "provider_stop",
  "verification",
  "total",
] as const;

export type ManagedExecutionStageV1 = (typeof managedExecutionStages)[number];

export interface GovernedTokenUsageV1 {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface ResourceGroupObservationV1 {
  schemaVersion: 1;
  provider: "codex" | "claude" | "lervo";
  scope: GovernedResourceScopeV1;
  source: "provider_reported" | "lervo_measured";
  accountingMode: "turn_cumulative" | "session_cumulative" | "operation_delta";
  accountingDescriptorHash: string;
  completeness: "complete" | "partial" | "unavailable" | "invalid";
  tokenUsage: GovernedTokenUsageV1 | null;
  totalTokens: number | null;
  runCount: number;
  reasonCodes: string[];
}

export interface ManagedStageGroupObservationV1 {
  schemaVersion: 1;
  provider: "codex" | "claude";
  scope: GovernedResourceScopeV1;
  stageId: ManagedExecutionStageV1;
  completeness: "complete" | "partial" | "unavailable" | "invalid";
  observations: Array<{
    runId: string;
    environmentProfileDigest: string;
    durationMs: number;
    outcome: "completed" | "failed" | "cancelled" | "timeout" | "abstained";
  }>;
  runCount: number;
  reasonCodes: string[];
}

export interface GovernedTokenLimitV1 {
  provider: "codex" | "claude" | "lervo";
  scope?: GovernedResourceScopeV1;
  accountingDescriptorHash: string;
  stopAfterObservedTotalTokens: number;
}

export interface GovernedTokenMetricLimitV1 {
  provider: "codex" | "claude" | "lervo";
  scope?: GovernedResourceScopeV1;
  accountingDescriptorHash: string;
  metric: (typeof governedTokenDimensionMetrics)[number];
  stopAfterObservedTokens: number;
}

export interface GovernedDurationLimitV1 {
  provider: "codex" | "claude";
  scope: GovernedResourceScopeV1;
  stageId: ManagedExecutionStageV1;
  stopAfterObservedDurationMs: number;
}

interface ManagedExecutionBudgetAssessmentBaseV1 {
  schemaVersion: 1;
  provider: "codex" | "claude" | "lervo";
  scope: GovernedResourceScopeV1 | null;
  completeness: "complete" | "partial" | "unavailable" | "invalid" | "unobserved";
  thresholdState: "below" | "reached" | "unknown";
}

export type ManagedExecutionBudgetAssessmentV1 =
  | (ManagedExecutionBudgetAssessmentBaseV1 & {
      kind: "token";
      accountingDescriptorHash: string;
      metric: GovernedTokenMetricV1;
      limitTokens: number;
      observedTokens: number | null;
      remainingObservedTokens: number | null;
    })
  | (ManagedExecutionBudgetAssessmentBaseV1 & {
      kind: "duration";
      provider: "codex" | "claude";
      scope: GovernedResourceScopeV1;
      stageId: ManagedExecutionStageV1;
      limitDurationMs: number;
      maximumObservedDurationMs: number | null;
      remainingObservedDurationMs: number | null;
      observationCount: number;
    });

export interface GovernedLoopPolicyV1 {
  schemaVersion: 1;
  maxAttemptsPerAssignment: number;
  maxParallelAssignments: number;
  tokenLimits: GovernedTokenLimitV1[];
  tokenMetricLimits: GovernedTokenMetricLimitV1[];
  durationLimits: GovernedDurationLimitV1[];
  unobservedResourceAction: "block" | "escalate";
  exhaustedResourceAction: "block" | "escalate";
  terminalFailureAction: "block" | "escalate";
}
