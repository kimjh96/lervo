import type {
  GovernedDurationLimitV1,
  GovernedLoopPolicyV1,
  GovernedTokenLimitV1,
  GovernedTokenMetricLimitV1,
} from "@lervo/application-contract";

export interface GovernedLoopOptionValues {
  "max-attempts"?: string;
  "max-parallel"?: string;
  "token-limit"?: string[];
  "token-metric-limit"?: string[];
  "duration-limit"?: string[];
  "unobserved-resource"?: string;
  "exhausted-resource"?: string;
  "terminal-failure"?: string;
}

export function boundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
  field = "governed-loop integer",
  minimum = 1,
): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`A ${field} is invalid.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`A ${field} is outside its bound.`);
  }
  return parsed;
}

function tokenLimits(values: string[] | undefined): GovernedTokenLimitV1[] {
  return (values ?? []).map((value) => {
    const match =
      /^(codex|claude|lervo):(?:(primary_provider|subagent_provider|query_projection|publication_evaluation|deliberation|improvement_evaluation):)?(sha256:[a-f0-9]{64}):([1-9]\d*)$/u.exec(
        value,
      );
    if (match === null) {
      throw new Error("--token-limit requires <provider>[:<scope>]:<descriptor-hash>:<tokens>.");
    }
    return {
      provider: match[1] as GovernedTokenLimitV1["provider"],
      ...(match[2] === undefined
        ? {}
        : { scope: match[2] as NonNullable<GovernedTokenLimitV1["scope"]> }),
      accountingDescriptorHash: match[3]!,
      stopAfterObservedTotalTokens: Number(match[4]),
    };
  });
}

function tokenMetricLimits(values: string[] | undefined): GovernedTokenMetricLimitV1[] {
  return (values ?? []).map((value) => {
    const match =
      /^(codex|claude|lervo):(?:(primary_provider|subagent_provider|query_projection|publication_evaluation|deliberation|improvement_evaluation):)?(sha256:[a-f0-9]{64}):(input_tokens|cached_input_tokens|output_tokens|reasoning_output_tokens):([1-9]\d*)$/u.exec(
        value,
      );
    if (match === null) {
      throw new Error(
        "--token-metric-limit requires <provider>[:<scope>]:<descriptor-hash>:<metric>:<tokens>.",
      );
    }
    return {
      provider: match[1] as GovernedTokenMetricLimitV1["provider"],
      ...(match[2] === undefined
        ? {}
        : { scope: match[2] as NonNullable<GovernedTokenMetricLimitV1["scope"]> }),
      accountingDescriptorHash: match[3]!,
      metric: match[4] as GovernedTokenMetricLimitV1["metric"],
      stopAfterObservedTokens: Number(match[5]),
    };
  });
}

function durationLimits(values: string[] | undefined): GovernedDurationLimitV1[] {
  return (values ?? []).map((value) => {
    const match =
      /^(codex|claude):(primary_provider|subagent_provider|query_projection|publication_evaluation|deliberation|improvement_evaluation):(repository_snapshot|provider_start|corpus_preparation|context_injection|provider_turn|provider_stop|verification|total):([1-9]\d*)$/u.exec(
        value,
      );
    if (match === null) {
      throw new Error("--duration-limit requires <provider>:<scope>:<stage>:<milliseconds>.");
    }
    return {
      provider: match[1] as GovernedDurationLimitV1["provider"],
      scope: match[2] as GovernedDurationLimitV1["scope"],
      stageId: match[3] as GovernedDurationLimitV1["stageId"],
      stopAfterObservedDurationMs: Number(match[4]),
    };
  });
}

export function parseGovernedLoopPolicy(
  values: GovernedLoopOptionValues,
): Partial<GovernedLoopPolicyV1> {
  const dispositions = [
    values["unobserved-resource"] ?? "escalate",
    values["exhausted-resource"] ?? "block",
    values["terminal-failure"] ?? "escalate",
  ];
  if (dispositions.some((value) => value !== "block" && value !== "escalate")) {
    throw new Error("A loop disposition must be block or escalate.");
  }
  return {
    maxAttemptsPerAssignment: boundedPositiveInteger(values["max-attempts"], 2, 16),
    maxParallelAssignments: boundedPositiveInteger(values["max-parallel"], 2, 32),
    tokenLimits: tokenLimits(values["token-limit"]),
    tokenMetricLimits: tokenMetricLimits(values["token-metric-limit"]),
    durationLimits: durationLimits(values["duration-limit"]),
    unobservedResourceAction: dispositions[0] as "block" | "escalate",
    exhaustedResourceAction: dispositions[1] as "block" | "escalate",
    terminalFailureAction: dispositions[2] as "block" | "escalate",
  };
}
