import type {
  ExecutionPerformanceProfile,
  ExecutionPerformanceSummary,
} from "./paired-benchmark.js";

export function performanceBasisPoints(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator * 10_000) / denominator);
}

export function performanceRegressionBudgetMilliseconds(baselineP95: number): number {
  if (!Number.isFinite(baselineP95) || baselineP95 < 0) {
    throw new TypeError("The performance regression baseline is invalid.");
  }
  return Math.max(25, baselineP95 * 0.1);
}

export function executionPerformanceFailureReasons(input: {
  profile: ExecutionPerformanceProfile;
  baseline: ExecutionPerformanceSummary;
  candidate: ExecutionPerformanceSummary;
  regressionBasisPoints: number;
  regressionMilliseconds: number;
  regressionBudgetMilliseconds: number;
}): string[] {
  const p95Budget = input.profile.hookEvent === "UserPromptSubmit" ? 15_000 : 5_000;
  const reasons: string[] = [];
  if (input.candidate.durationMs.maximum >= 30_000) reasons.push("external_ceiling_reached");
  if (input.candidate.durationMs.p95 > p95Budget) reasons.push("p95_budget_exceeded");
  if (
    input.profile.hookEvent === "UserPromptSubmit" &&
    input.candidate.durationMs.p99 !== null &&
    input.candidate.durationMs.p99 > 24_000
  )
    reasons.push("p99_budget_exceeded");
  if (
    input.regressionBasisPoints > 11_000 &&
    input.regressionMilliseconds > input.regressionBudgetMilliseconds
  )
    reasons.push("p95_regression_exceeded");
  if (input.candidate.failures > 0 || input.candidate.timeouts > 0)
    reasons.push("candidate_execution_failed");
  if (Object.values(input.candidate.correctness).some((status) => status !== "passed"))
    reasons.push("correctness_failed");
  if (input.baseline.failures > 0 || input.baseline.timeouts > 0)
    reasons.push("baseline_execution_failed");
  if (Object.values(input.baseline.correctness).some((status) => status !== "passed"))
    reasons.push("baseline_correctness_failed");
  return reasons;
}
