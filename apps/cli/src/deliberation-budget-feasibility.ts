import type { DeliberationPolicy, WritingContract } from "@lervo/schemas";

export function minimumDeliberationProviderCalls(input: {
  maxRounds: number;
  reviewerCount: number;
  verificationSuiteCount: number;
  writingContract: WritingContract;
}): number {
  const publicationTurns =
    1 +
    input.reviewerCount * input.maxRounds +
    Math.max(0, input.maxRounds - 1) +
    input.verificationSuiteCount +
    1;
  const requiresSemanticEvaluation = input.writingContract.verification.semanticChecks.some(
    (check) => check.required,
  );
  return publicationTurns * (requiresSemanticEvaluation ? 2 : 1);
}

export function assertDeliberationCallBudgetFeasible(input: {
  policy: DeliberationPolicy & {
    executionBudget: NonNullable<DeliberationPolicy["executionBudget"]>;
  };
  reviewerCount: number;
  writingContract: WritingContract;
}): void {
  const minimum = minimumDeliberationProviderCalls({
    maxRounds: input.policy.maxRounds,
    reviewerCount: input.reviewerCount,
    verificationSuiteCount: input.policy.requiredVerificationSuiteIds.length,
    writingContract: input.writingContract,
  });
  if (input.policy.executionBudget.maximumProviderCalls < minimum) {
    throw Object.assign(
      new Error(
        `The deliberation policy permits ${input.policy.executionBudget.maximumProviderCalls} provider calls, but its configured rounds, roles, verification, and writing evaluation require at least ${minimum} calls to complete without repair.`,
      ),
      { code: "deliberation_policy_budget_infeasible" },
    );
  }
}
