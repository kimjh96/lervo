import { createHash } from "node:crypto";

import {
  executionEnvironmentProfileHash,
  assertExecutionEnvironmentProfile,
} from "@lervo/execution-contract";
import {
  executionStageIds,
  type ExecutionEnvironmentProfile,
  type RepositoryPerformanceProfile,
} from "@lervo/schemas";

import {
  performanceDifferenceDistribution,
  performanceDistribution,
  type PerformanceDistribution,
} from "./statistics.js";
import {
  executionPerformanceFailureReasons,
  performanceBasisPoints,
  performanceRegressionBudgetMilliseconds,
} from "./budget-policy.js";
import {
  assessExecutionPerformanceProfileAcceptance,
  type ExecutionPerformanceMeasurementEnvironment,
} from "./profile-acceptance.js";

export type PerformanceArm = "baseline" | "candidate";
export type PerformanceHook = "UserPromptSubmit" | "Stop";

export interface ExecutionPerformanceProfile {
  profileId: string;
  environment: ExecutionEnvironmentProfile;
  environmentProfileDigest: string;
  repositoryProfile: RepositoryPerformanceProfile;
  cacheState: "cold" | "warm";
  concurrency: number;
  hookEvent: PerformanceHook;
  observationUnit: "hook_invocation" | "concurrent_batch";
}

export interface ExecutionPerformanceSampleResult {
  outcome: "completed" | "failed" | "timeout";
  stages: Partial<Record<(typeof executionStageIds)[number], number>>;
  retrievalCorrect: boolean;
  lifecycleCorrect: boolean;
  privacyCorrect: boolean;
}

export interface ExecutionPerformanceObservation {
  arm: PerformanceArm;
  repetition: number;
  durationMs: number;
  cpuMs: number;
  processPeakResidentMemoryBytes: number;
  result: ExecutionPerformanceSampleResult;
}

export interface ExecutionPerformanceSummary {
  arm: PerformanceArm;
  durationMs: PerformanceDistribution;
  cpuMs: PerformanceDistribution;
  maximumProcessPeakResidentMemoryBytes: number;
  failures: number;
  timeouts: number;
  failureRateBasisPoints: number;
  correctness: {
    retrieval: "passed" | "failed";
    lifecycle: "passed" | "failed";
    privacy: "passed" | "failed";
  };
  stages: Array<{
    stageId: (typeof executionStageIds)[number];
    durationMs: PerformanceDistribution;
  }>;
}

export interface ExecutionPerformanceProfileReport {
  profile: ExecutionPerformanceProfile;
  population: number;
  baseline: ExecutionPerformanceSummary;
  candidate: ExecutionPerformanceSummary;
  instrumentationOverheadMs: PerformanceDistribution;
  candidateP95RegressionBasisPoints: number;
  candidateP95RegressionMs: number;
  candidateP95RegressionBudgetMs: number;
  measurementEnvironment: ExecutionPerformanceMeasurementEnvironment;
  budgetStatus: "passed" | "failed";
  acceptanceStatus: "passed" | "failed";
  failureReasons: string[];
}

export interface ExecutionPerformanceReport {
  schemaVersion: 1;
  reportId: string;
  benchmarkBuildDigest: string;
  repositoryRevision: string;
  repetitions: number;
  profiles: ExecutionPerformanceProfileReport[];
  allProfilesPassed: boolean;
  privacy: {
    prompts: "excluded";
    outputs: "excluded";
    repositoryPaths: "excluded";
    credentials: "excluded";
  };
}

export interface ExecutionPerformancePorts<TFixture = undefined> {
  prepareSample?(input: {
    profile: ExecutionPerformanceProfile;
    arm: PerformanceArm;
    repetition: number;
  }): Promise<TFixture>;
  run(input: {
    profile: ExecutionPerformanceProfile;
    arm: PerformanceArm;
    repetition: number;
    fixture: TFixture;
  }): Promise<ExecutionPerformanceSampleResult>;
  cleanupSample?(fixture: TFixture): Promise<void>;
  nowNanoseconds?: () => bigint;
  cpuUsage?: () => { user: number; system: number };
  processPeakResidentMemoryBytes?: () => number;
}

const BENCHMARK_PROTOCOL = {
  schemaVersion: 1,
  pairing: "alternating_order_v1",
  percentiles: "nearest_rank_v1",
  p99MinimumPopulation: 100,
  correctness: "retrieval_lifecycle_privacy_v1",
  budgets: "foundation_fh3_v3_relative_10_percent_or_25ms_floor",
  measurementEnvironment: "baseline_p95_to_p50_max_2x_v1",
  attemptPolicy: "single_complete_observation_no_automatic_retry_v1",
  privacy: "aggregate_only_v1",
} as const;

export const EXECUTION_PERFORMANCE_BENCHMARK_BUILD_DIGEST = `sha256:${createHash("sha256")
  .update(JSON.stringify(BENCHMARK_PROTOCOL))
  .digest("hex")}`;

const PROFILE_ID = /^pf_[a-z0-9][a-z0-9_-]{2,63}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function summary(
  arm: PerformanceArm,
  observations: readonly ExecutionPerformanceObservation[],
): ExecutionPerformanceSummary {
  const stageIds = executionStageIds.filter((stageId) =>
    observations.some((item) => item.result.stages[stageId] !== undefined),
  );
  return {
    arm,
    durationMs: performanceDistribution(observations.map((item) => item.durationMs)),
    cpuMs: performanceDistribution(observations.map((item) => item.cpuMs)),
    maximumProcessPeakResidentMemoryBytes: Math.max(
      ...observations.map((item) => item.processPeakResidentMemoryBytes),
    ),
    failures: observations.filter((item) => item.result.outcome === "failed").length,
    timeouts: observations.filter((item) => item.result.outcome === "timeout").length,
    failureRateBasisPoints: performanceBasisPoints(
      observations.filter((item) => item.result.outcome !== "completed").length,
      observations.length,
    ),
    correctness: {
      retrieval: observations.every((item) => item.result.retrievalCorrect) ? "passed" : "failed",
      lifecycle: observations.every((item) => item.result.lifecycleCorrect) ? "passed" : "failed",
      privacy: observations.every((item) => item.result.privacyCorrect) ? "passed" : "failed",
    },
    stages: stageIds.map((stageId) => ({
      stageId,
      durationMs: performanceDistribution(
        observations.flatMap((item) => {
          const value = item.result.stages[stageId];
          return value === undefined ? [] : [value];
        }),
      ),
    })),
  };
}

export function assertExecutionPerformanceProfiles(
  profiles: readonly ExecutionPerformanceProfile[],
): void {
  if (profiles.length < 1 || profiles.length > 32) {
    throw new TypeError("The execution performance profile count is invalid.");
  }
  const ids = new Set<string>();
  for (const profile of profiles) {
    assertExecutionEnvironmentProfile(profile.environment);
    if (
      !PROFILE_ID.test(profile.profileId) ||
      ids.has(profile.profileId) ||
      profile.environment.profileSource !== "benchmark_declared" ||
      profile.environmentProfileDigest !== executionEnvironmentProfileHash(profile.environment) ||
      profile.environment.repositoryProfile !== profile.repositoryProfile ||
      profile.environment.cacheState !== profile.cacheState ||
      profile.environment.concurrency !== profile.concurrency ||
      (profile.observationUnit === "hook_invocation" && profile.concurrency !== 1) ||
      (profile.observationUnit === "concurrent_batch" && profile.concurrency === 1) ||
      !Number.isSafeInteger(profile.concurrency) ||
      profile.concurrency < 1 ||
      profile.concurrency > 256
    ) {
      throw new TypeError("An execution performance profile is invalid.");
    }
    ids.add(profile.profileId);
  }
}

function elapsedMilliseconds(start: bigint, end: bigint): number {
  if (end < start) throw new TypeError("The benchmark monotonic clock regressed.");
  return Number((end - start) / 1_000n) / 1_000;
}

function cpuMilliseconds(
  start: { user: number; system: number },
  end: { user: number; system: number },
): number {
  const microseconds = end.user + end.system - start.user - start.system;
  if (!Number.isFinite(microseconds) || microseconds < 0)
    throw new TypeError("The benchmark CPU observation regressed.");
  return microseconds / 1_000;
}

export async function runPairedExecutionPerformanceBenchmark<TFixture = undefined>(input: {
  repositoryRevision: string;
  repetitions: number;
  profiles: readonly ExecutionPerformanceProfile[];
  ports: ExecutionPerformancePorts<TFixture>;
}): Promise<ExecutionPerformanceReport> {
  assertExecutionPerformanceProfiles(input.profiles);
  if (!SHA256.test(input.repositoryRevision))
    throw new TypeError("The benchmark repository revision is invalid.");
  if (
    !Number.isSafeInteger(input.repetitions) ||
    input.repetitions < 100 ||
    input.repetitions > 500
  )
    throw new TypeError("Deterministic performance profiles require 100 to 500 repetitions.");
  const now = input.ports.nowNanoseconds ?? process.hrtime.bigint;
  const cpu = input.ports.cpuUsage ?? process.cpuUsage;
  const processPeakMemory =
    input.ports.processPeakResidentMemoryBytes ?? (() => process.resourceUsage().maxRSS * 1024);
  const reports: ExecutionPerformanceProfileReport[] = [];
  for (const profile of input.profiles) {
    const observations: ExecutionPerformanceObservation[] = [];
    for (let repetition = 1; repetition <= input.repetitions; repetition += 1) {
      const order: PerformanceArm[] =
        repetition % 2 === 1 ? ["baseline", "candidate"] : ["candidate", "baseline"];
      for (const arm of order) {
        const fixture = input.ports.prepareSample
          ? await input.ports.prepareSample({ profile, arm, repetition })
          : (undefined as TFixture);
        try {
          const started = now();
          const cpuStarted = cpu();
          const result = await input.ports.run({ profile, arm, repetition, fixture });
          const cpuEnded = cpu();
          const ended = now();
          observations.push({
            arm,
            repetition,
            durationMs: elapsedMilliseconds(started, ended),
            cpuMs: cpuMilliseconds(cpuStarted, cpuEnded),
            processPeakResidentMemoryBytes: processPeakMemory(),
            result,
          });
        } finally {
          await input.ports.cleanupSample?.(fixture);
        }
      }
    }
    const baselineObservations = observations.filter((item) => item.arm === "baseline");
    const candidateObservations = observations.filter((item) => item.arm === "candidate");
    const baseline = summary("baseline", baselineObservations);
    const candidate = summary("candidate", candidateObservations);
    const pairedOverhead = Array.from({ length: input.repetitions }, (_, index) => {
      const repetition = index + 1;
      const baselineDuration = baselineObservations.find(
        (item) => item.repetition === repetition,
      )!.durationMs;
      const candidateDuration = candidateObservations.find(
        (item) => item.repetition === repetition,
      )!.durationMs;
      return candidateDuration - baselineDuration;
    });
    const regressionBasisPoints = performanceBasisPoints(
      candidate.durationMs.p95,
      baseline.durationMs.p95,
    );
    const regressionMilliseconds = Math.max(0, candidate.durationMs.p95 - baseline.durationMs.p95);
    const regressionBudgetMilliseconds = performanceRegressionBudgetMilliseconds(
      baseline.durationMs.p95,
    );
    const budgetFailureReasons = executionPerformanceFailureReasons({
      profile,
      baseline,
      candidate,
      regressionBasisPoints,
      regressionMilliseconds,
      regressionBudgetMilliseconds,
    });
    const profileAcceptance = assessExecutionPerformanceProfileAcceptance({
      baselineDurationMs: baseline.durationMs,
      budgetFailureReasons,
    });
    reports.push({
      profile: structuredClone(profile),
      population: input.repetitions,
      baseline,
      candidate,
      instrumentationOverheadMs: performanceDifferenceDistribution(pairedOverhead),
      candidateP95RegressionBasisPoints: regressionBasisPoints,
      candidateP95RegressionMs: regressionMilliseconds,
      candidateP95RegressionBudgetMs: regressionBudgetMilliseconds,
      measurementEnvironment: profileAcceptance.measurementEnvironment,
      budgetStatus: budgetFailureReasons.length === 0 ? "passed" : "failed",
      acceptanceStatus: profileAcceptance.acceptanceStatus,
      failureReasons: profileAcceptance.failureReasons,
    });
  }
  const source = {
    schemaVersion: 1 as const,
    benchmarkBuildDigest: EXECUTION_PERFORMANCE_BENCHMARK_BUILD_DIGEST,
    repositoryRevision: input.repositoryRevision,
    repetitions: input.repetitions,
    profiles: reports,
    allProfilesPassed: reports.every((item) => item.acceptanceStatus === "passed"),
    privacy: {
      prompts: "excluded" as const,
      outputs: "excluded" as const,
      repositoryPaths: "excluded" as const,
      credentials: "excluded" as const,
    },
  };
  const reportId = executionPerformanceReportId(source);
  return { ...source, reportId };
}

export function executionPerformanceReportId(
  source: Omit<ExecutionPerformanceReport, "reportId">,
): string {
  return `perf_${createHash("sha256").update(JSON.stringify(source)).digest("hex").slice(0, 24)}`;
}
