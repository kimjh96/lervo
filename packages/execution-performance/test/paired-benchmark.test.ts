import { describe, expect, it } from "vitest";
import { executionEnvironmentProfileHash } from "@lervo/execution-contract";

import {
  EXECUTION_PERFORMANCE_BENCHMARK_BUILD_DIGEST,
  performanceDifferenceDistribution,
  performanceDistribution,
  runPairedExecutionPerformanceBenchmark,
  verifyExecutionPerformanceReport,
} from "../src/index.js";

function environment() {
  return {
    kind: "execution_environment_profile" as const,
    schemaVersion: 1 as const,
    profileSource: "benchmark_declared" as const,
    lervoBuildDigest: `sha256:${"c".repeat(64)}`,
    adapterId: null,
    adapterVersion: null,
    provider: null,
    operatingSystem: "test",
    architecture: "test",
    nodeVersion: "test",
    repositoryProfile: "small" as const,
    repositoryDocumentCount: 10,
    repositoryByteCount: 1024,
    cacheState: "warm" as const,
    concurrency: 1,
  };
}

describe("paired execution performance benchmark", () => {
  it("uses nearest-rank percentiles and withholds p99 below 100 samples", () => {
    expect(performanceDistribution([4, 1, 3, 2])).toEqual({
      sampleCount: 4,
      p50: 2,
      p95: 4,
      p99: null,
      maximum: 4,
    });
    expect(performanceDistribution(Array.from({ length: 100 }, (_, index) => index + 1)).p99).toBe(
      99,
    );
    expect(performanceDifferenceDistribution([-3, -1, 2])).toMatchObject({
      p50: -1,
      maximum: 2,
    });
    expect(EXECUTION_PERFORMANCE_BENCHMARK_BUILD_DIGEST).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("alternates paired arms and enforces latency, regression, and correctness gates", async () => {
    let nanoseconds = 0n;
    let cpu = 0;
    const order: string[] = [];
    const declaredEnvironment = environment();
    const report = await runPairedExecutionPerformanceBenchmark({
      repositoryRevision: `sha256:${"a".repeat(64)}`,
      repetitions: 100,
      profiles: [
        {
          profileId: "pf_small_warm_prompt",
          environment: declaredEnvironment,
          environmentProfileDigest: executionEnvironmentProfileHash(declaredEnvironment),
          repositoryProfile: "small",
          cacheState: "warm",
          concurrency: 1,
          hookEvent: "UserPromptSubmit",
          observationUnit: "hook_invocation",
        },
      ],
      ports: {
        nowNanoseconds: () => {
          const value = nanoseconds;
          nanoseconds += 10_000_000n;
          return value;
        },
        cpuUsage: () => ({ user: cpu++, system: 0 }),
        processPeakResidentMemoryBytes: () => 1024,
        run: async ({ arm, repetition }) => {
          order.push(`${repetition}:${arm}`);
          return {
            outcome: "completed",
            stages: { total: 10, search: 2 },
            retrievalCorrect: true,
            lifecycleCorrect: true,
            privacyCorrect: true,
          };
        },
      },
    });

    expect(order.slice(0, 4)).toEqual(["1:baseline", "1:candidate", "2:candidate", "2:baseline"]);
    expect(report).toMatchObject({
      allProfilesPassed: true,
      repetitions: 100,
      profiles: [
        {
          population: 100,
          budgetStatus: "passed",
          candidate: {
            durationMs: { sampleCount: 100, p99: 10 },
            correctness: { retrieval: "passed", lifecycle: "passed", privacy: "passed" },
          },
        },
      ],
    });
    expect(verifyExecutionPerformanceReport(report)).toEqual(report);
    expect(() => verifyExecutionPerformanceReport({ ...report, allProfilesPassed: false })).toThrow(
      "identity",
    );
  });
});
