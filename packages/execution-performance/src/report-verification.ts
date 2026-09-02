import { executionStageIds } from "@lervo/schemas";

import {
  executionPerformanceFailureReasons,
  performanceBasisPoints,
  performanceRegressionBudgetMilliseconds,
} from "./budget-policy.js";
import {
  assertExecutionPerformanceProfiles,
  EXECUTION_PERFORMANCE_BENCHMARK_BUILD_DIGEST,
  executionPerformanceReportId,
  type ExecutionPerformanceReport,
  type ExecutionPerformanceSummary,
} from "./paired-benchmark.js";
import type { PerformanceDistribution } from "./statistics.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REPORT_ID = /^perf_[a-f0-9]{24}$/u;

function assertDistribution(
  value: PerformanceDistribution,
  expectedPopulation: number | null,
  allowNegative: boolean,
): void {
  const ordered = [value.p50, value.p95, ...(value.p99 === null ? [] : [value.p99]), value.maximum];
  if (
    !Number.isSafeInteger(value.sampleCount) ||
    value.sampleCount < 1 ||
    (expectedPopulation !== null && value.sampleCount !== expectedPopulation) ||
    ordered.some((item) => !Number.isFinite(item) || (!allowNegative && item < 0)) ||
    ordered.some((item, index) => index > 0 && item < ordered[index - 1]!) ||
    value.sampleCount >= 100 !== (value.p99 !== null)
  ) {
    throw new TypeError("An execution performance distribution is invalid.");
  }
}

function assertSummary(
  summary: ExecutionPerformanceSummary,
  arm: "baseline" | "candidate",
  population: number,
): void {
  assertDistribution(summary.durationMs, population, false);
  assertDistribution(summary.cpuMs, population, false);
  if (
    summary.arm !== arm ||
    !Number.isFinite(summary.maximumProcessPeakResidentMemoryBytes) ||
    summary.maximumProcessPeakResidentMemoryBytes < 0 ||
    !Number.isSafeInteger(summary.failures) ||
    !Number.isSafeInteger(summary.timeouts) ||
    summary.failures < 0 ||
    summary.timeouts < 0 ||
    summary.failures + summary.timeouts > population ||
    summary.failureRateBasisPoints !==
      performanceBasisPoints(summary.failures + summary.timeouts, population) ||
    Object.values(summary.correctness).some((status) => status !== "passed" && status !== "failed")
  ) {
    throw new TypeError("An execution performance summary is invalid.");
  }
  const stageIds = new Set<string>();
  for (const stage of summary.stages) {
    if (!executionStageIds.includes(stage.stageId) || stageIds.has(stage.stageId)) {
      throw new TypeError("An execution performance stage distribution is invalid.");
    }
    stageIds.add(stage.stageId);
    assertDistribution(stage.durationMs, null, false);
    if (stage.durationMs.sampleCount > population) {
      throw new TypeError("An execution performance stage population is invalid.");
    }
  }
}

export function verifyExecutionPerformanceReport(value: unknown): ExecutionPerformanceReport {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("The execution performance report is invalid.");
  }
  const report = value as ExecutionPerformanceReport;
  if (
    report.schemaVersion !== 1 ||
    !REPORT_ID.test(report.reportId) ||
    report.benchmarkBuildDigest !== EXECUTION_PERFORMANCE_BENCHMARK_BUILD_DIGEST ||
    !SHA256.test(report.repositoryRevision) ||
    !Number.isSafeInteger(report.repetitions) ||
    report.repetitions < 100 ||
    report.repetitions > 500 ||
    !Array.isArray(report.profiles) ||
    report.profiles.length < 1 ||
    report.profiles.length > 32 ||
    report.privacy?.prompts !== "excluded" ||
    report.privacy.outputs !== "excluded" ||
    report.privacy.repositoryPaths !== "excluded" ||
    report.privacy.credentials !== "excluded"
  ) {
    throw new TypeError("The execution performance report header is invalid.");
  }
  assertExecutionPerformanceProfiles(report.profiles.map((item) => item.profile));
  for (const profile of report.profiles) {
    if (profile.population !== report.repetitions) {
      throw new TypeError("The execution performance profile population is invalid.");
    }
    assertSummary(profile.baseline, "baseline", profile.population);
    assertSummary(profile.candidate, "candidate", profile.population);
    assertDistribution(profile.instrumentationOverheadMs, profile.population, true);
    const regression = performanceBasisPoints(
      profile.candidate.durationMs.p95,
      profile.baseline.durationMs.p95,
    );
    const regressionMilliseconds = Math.max(
      0,
      profile.candidate.durationMs.p95 - profile.baseline.durationMs.p95,
    );
    const regressionBudgetMilliseconds = performanceRegressionBudgetMilliseconds(
      profile.baseline.durationMs.p95,
    );
    const reasons = executionPerformanceFailureReasons({
      profile: profile.profile,
      baseline: profile.baseline,
      candidate: profile.candidate,
      regressionBasisPoints: regression,
      regressionMilliseconds,
      regressionBudgetMilliseconds,
    });
    if (
      profile.candidateP95RegressionBasisPoints !== regression ||
      profile.candidateP95RegressionMs !== regressionMilliseconds ||
      profile.candidateP95RegressionBudgetMs !== regressionBudgetMilliseconds ||
      JSON.stringify(profile.failureReasons) !== JSON.stringify(reasons) ||
      profile.budgetStatus !== (reasons.length === 0 ? "passed" : "failed")
    ) {
      throw new TypeError("The execution performance budget decision is inconsistent.");
    }
  }
  const allProfilesPassed = report.profiles.every((item) => item.budgetStatus === "passed");
  const { reportId: _reportId, ...source } = report;
  if (
    report.allProfilesPassed !== allProfilesPassed ||
    report.reportId !== executionPerformanceReportId(source)
  ) {
    throw new TypeError("The execution performance report identity is invalid.");
  }
  return structuredClone(report);
}
