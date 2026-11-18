export const governedResourceScopes = [
  "primary_provider",
  "subagent_provider",
  "query_projection",
  "publication_evaluation",
  "deliberation",
  "improvement_evaluation",
] as const;

export type GovernedResourceScopeV1 = (typeof governedResourceScopes)[number];

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
  source: "provider_reported" | "lervo_measured" | "estimated";
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
