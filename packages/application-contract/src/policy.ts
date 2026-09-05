import type {
  GovernedDurationLimitV1,
  GovernedLoopPolicyV1,
  GovernedTokenLimitV1,
  GovernedTokenMetricLimitV1,
} from "./managed-execution-budget.js";
import {
  governedResourceScopes,
  governedTokenDimensionMetrics,
  managedExecutionStages,
} from "./managed-execution-budget.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
function positiveInteger(value: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${field} is outside the governed-loop bound.`);
  }
  return value;
}

function normalizeTokenLimits(values: readonly GovernedTokenLimitV1[]): GovernedTokenLimitV1[] {
  if (values.length > 32) throw new TypeError("The governed-loop token-limit bound was exceeded.");
  const limits = values
    .map((value) => ({
      provider: value.provider,
      ...(value.scope === undefined ? {} : { scope: value.scope }),
      accountingDescriptorHash: value.accountingDescriptorHash,
      stopAfterObservedTotalTokens: positiveInteger(
        value.stopAfterObservedTotalTokens,
        Number.MAX_SAFE_INTEGER,
        "stopAfterObservedTotalTokens",
      ),
    }))
    .sort((left, right) =>
      `${left.provider}\0${left.scope ?? "*"}\0${left.accountingDescriptorHash}`.localeCompare(
        `${right.provider}\0${right.scope ?? "*"}\0${right.accountingDescriptorHash}`,
      ),
    );
  if (
    limits.some(
      (value) =>
        !["codex", "claude", "lervo"].includes(value.provider) ||
        (value.scope !== undefined && !governedResourceScopes.includes(value.scope)) ||
        !HASH.test(value.accountingDescriptorHash),
    ) ||
    new Set(
      limits.map(
        (value) => `${value.provider}\0${value.scope ?? "*"}\0${value.accountingDescriptorHash}`,
      ),
    ).size !== limits.length
  ) {
    throw new TypeError("The governed-loop token-limit coordinates are invalid.");
  }
  return limits;
}

function normalizeTokenMetricLimits(
  values: readonly GovernedTokenMetricLimitV1[],
): GovernedTokenMetricLimitV1[] {
  if (values.length > 32) {
    throw new TypeError("The governed-loop token-metric-limit bound was exceeded.");
  }
  const limits = values
    .map((value) => ({
      provider: value.provider,
      ...(value.scope === undefined ? {} : { scope: value.scope }),
      accountingDescriptorHash: value.accountingDescriptorHash,
      metric: value.metric,
      stopAfterObservedTokens: positiveInteger(
        value.stopAfterObservedTokens,
        Number.MAX_SAFE_INTEGER,
        "stopAfterObservedTokens",
      ),
    }))
    .sort((left, right) =>
      `${left.provider}\0${left.scope ?? "*"}\0${left.accountingDescriptorHash}\0${left.metric}`.localeCompare(
        `${right.provider}\0${right.scope ?? "*"}\0${right.accountingDescriptorHash}\0${right.metric}`,
      ),
    );
  if (
    limits.some(
      (value) =>
        !["codex", "claude", "lervo"].includes(value.provider) ||
        (value.scope !== undefined && !governedResourceScopes.includes(value.scope)) ||
        !governedTokenDimensionMetrics.includes(value.metric) ||
        !HASH.test(value.accountingDescriptorHash),
    ) ||
    new Set(
      limits.map(
        (value) =>
          `${value.provider}\0${value.scope ?? "*"}\0${value.accountingDescriptorHash}\0${value.metric}`,
      ),
    ).size !== limits.length
  ) {
    throw new TypeError("The governed-loop token-metric-limit coordinates are invalid.");
  }
  return limits;
}

function normalizeDurationLimits(
  values: readonly GovernedDurationLimitV1[],
): GovernedDurationLimitV1[] {
  if (values.length > 32) {
    throw new TypeError("The governed-loop duration-limit bound was exceeded.");
  }
  const limits = values
    .map((value) => ({
      provider: value.provider,
      scope: value.scope,
      stageId: value.stageId,
      stopAfterObservedDurationMs: positiveInteger(
        value.stopAfterObservedDurationMs,
        Number.MAX_SAFE_INTEGER,
        "stopAfterObservedDurationMs",
      ),
    }))
    .sort((left, right) =>
      `${left.provider}\0${left.scope}\0${left.stageId}`.localeCompare(
        `${right.provider}\0${right.scope}\0${right.stageId}`,
      ),
    );
  if (
    limits.some(
      (value) =>
        !["codex", "claude"].includes(value.provider) ||
        !governedResourceScopes.includes(value.scope) ||
        !managedExecutionStages.includes(value.stageId),
    ) ||
    new Set(limits.map((value) => `${value.provider}\0${value.scope}\0${value.stageId}`)).size !==
      limits.length
  ) {
    throw new TypeError("The governed-loop duration-limit coordinates are invalid.");
  }
  return limits;
}

export function normalizeGovernedLoopPolicy(
  input: Partial<GovernedLoopPolicyV1> = {},
): GovernedLoopPolicyV1 {
  const unobservedResourceAction = input.unobservedResourceAction ?? "escalate";
  const exhaustedResourceAction = input.exhaustedResourceAction ?? "block";
  const terminalFailureAction = input.terminalFailureAction ?? "escalate";
  if (
    !["block", "escalate"].includes(unobservedResourceAction) ||
    !["block", "escalate"].includes(exhaustedResourceAction) ||
    !["block", "escalate"].includes(terminalFailureAction)
  ) {
    throw new TypeError("A governed-loop failure disposition is invalid.");
  }
  return {
    schemaVersion: 1,
    maxAttemptsPerAssignment: positiveInteger(
      input.maxAttemptsPerAssignment ?? 2,
      16,
      "maxAttemptsPerAssignment",
    ),
    maxParallelAssignments: positiveInteger(
      input.maxParallelAssignments ?? 2,
      32,
      "maxParallelAssignments",
    ),
    tokenLimits: normalizeTokenLimits(input.tokenLimits ?? []),
    tokenMetricLimits: normalizeTokenMetricLimits(input.tokenMetricLimits ?? []),
    durationLimits: normalizeDurationLimits(input.durationLimits ?? []),
    unobservedResourceAction,
    exhaustedResourceAction,
    terminalFailureAction,
  };
}
