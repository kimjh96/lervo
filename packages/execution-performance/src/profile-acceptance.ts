import type { PerformanceDistribution } from "./statistics.js";

export const EXECUTION_PERFORMANCE_BASELINE_TAIL_LIMIT_BASIS_POINTS = 20_000;

export type ExecutionPerformanceMeasurementEnvironmentFailureReason =
  "baseline_p95_tail_inflation_exceeded";

export interface ExecutionPerformanceMeasurementEnvironment {
  status: "stable" | "unstable";
  baselineP95ToP50BasisPoints: number | null;
  maximumBaselineP95ToP50BasisPoints: number;
  failureReasons: ExecutionPerformanceMeasurementEnvironmentFailureReason[];
}

export interface ExecutionPerformanceProfileAcceptance {
  measurementEnvironment: ExecutionPerformanceMeasurementEnvironment;
  acceptanceStatus: "passed" | "failed";
  failureReasons: string[];
}

export function assessExecutionPerformanceMeasurementEnvironment(
  baselineDurationMs: PerformanceDistribution,
): ExecutionPerformanceMeasurementEnvironment {
  const calculatedRatio =
    baselineDurationMs.p50 === 0
      ? baselineDurationMs.p95 === 0
        ? 10_000
        : null
      : Math.round((baselineDurationMs.p95 * 10_000) / baselineDurationMs.p50);
  const ratio =
    calculatedRatio !== null && Number.isSafeInteger(calculatedRatio) ? calculatedRatio : null;
  const failureReasons: ExecutionPerformanceMeasurementEnvironmentFailureReason[] = [];
  if (
    ratio === null ||
    baselineDurationMs.p95 * 10_000 >
      baselineDurationMs.p50 * EXECUTION_PERFORMANCE_BASELINE_TAIL_LIMIT_BASIS_POINTS
  ) {
    failureReasons.push("baseline_p95_tail_inflation_exceeded");
  }
  return {
    status: failureReasons.length === 0 ? "stable" : "unstable",
    baselineP95ToP50BasisPoints: ratio,
    maximumBaselineP95ToP50BasisPoints: EXECUTION_PERFORMANCE_BASELINE_TAIL_LIMIT_BASIS_POINTS,
    failureReasons,
  };
}

export function assessExecutionPerformanceProfileAcceptance(input: {
  baselineDurationMs: PerformanceDistribution;
  budgetFailureReasons: readonly string[];
}): ExecutionPerformanceProfileAcceptance {
  const measurementEnvironment = assessExecutionPerformanceMeasurementEnvironment(
    input.baselineDurationMs,
  );
  const failureReasons = [
    ...input.budgetFailureReasons,
    ...(measurementEnvironment.status === "unstable" ? ["measurement_environment_unstable"] : []),
  ];
  return {
    measurementEnvironment,
    acceptanceStatus: failureReasons.length === 0 ? "passed" : "failed",
    failureReasons,
  };
}
