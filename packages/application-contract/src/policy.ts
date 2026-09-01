import type { GovernedLoopPolicyV1, GovernedTokenLimitV1 } from "./types.js";

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
      accountingDescriptorHash: value.accountingDescriptorHash,
      stopAfterObservedTotalTokens: positiveInteger(
        value.stopAfterObservedTotalTokens,
        Number.MAX_SAFE_INTEGER,
        "stopAfterObservedTotalTokens",
      ),
    }))
    .sort((left, right) =>
      `${left.provider}\0${left.accountingDescriptorHash}`.localeCompare(
        `${right.provider}\0${right.accountingDescriptorHash}`,
      ),
    );
  if (
    limits.some(
      (value) =>
        !["codex", "claude", "lervo"].includes(value.provider) ||
        !HASH.test(value.accountingDescriptorHash),
    ) ||
    new Set(limits.map((value) => `${value.provider}\0${value.accountingDescriptorHash}`)).size !==
      limits.length
  ) {
    throw new TypeError("The governed-loop token-limit coordinates are invalid.");
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
    unobservedResourceAction,
    exhaustedResourceAction,
    terminalFailureAction,
  };
}
