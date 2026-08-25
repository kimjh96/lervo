import { cpus, freemem, hostname, platform, release, totalmem } from "node:os";

import { prepareSearchCorpus } from "./corpus.js";
import {
  assertSearchAdapterBuildId,
  assertSearchEngineIdentity,
  sameSearchEngine,
  type SearchEvaluationEnginePort,
  type SearchEvaluationIndexPort,
} from "./evaluation-engine.js";
import { canonicalHash, contentId } from "./integrity.js";
import { SEARCH_MAX_RESULTS, SearchError, type SearchSourceInput } from "./types.js";

const CASE_ID = /^spcase_[a-z0-9][a-z0-9_-]{2,63}$/u;
const TASK_TYPE = /^[a-z][a-z0-9_-]{2,63}$/u;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

export const SEARCH_PERFORMANCE_BENCHMARK_BUILD_ID = contentId("spbuild", {
  schemaVersion: 1,
  quality: "success-recall-reciprocal-rank-v1",
  taskComparison: "coverage-and-ranking-v1",
  latency: "alternating-pairs-monotonic-v1",
  thresholds: "repository-observation-v1",
});

export interface SearchPerformanceCase {
  caseId: string;
  taskType: string;
  provenance: "human_reviewed" | "verification_authored";
  query: string;
  expectedSources: Array<{ kind: SearchSourceInput["kind"]; sourceId: string }>;
  maximumRank: 10;
}

export interface SearchPerformanceEnvironment {
  platform: string;
  release: string;
  architecture: string;
  processor: string;
  logicalProcessorCount: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  runtime: string;
  runtimeFlags: string[];
  hostnameDigest: string;
  powerMode: "unobserved";
  competingWorkloads: "unobserved";
}

export interface SearchPerformanceProtocol {
  buildWarmupPairs: number;
  buildRecordedPairs: number;
  queryWarmupPasses: number;
  queryRecordedRepetitions: number;
  requestedLimit: 50;
}

export interface SearchQualityCaseObservation {
  caseId: string;
  taskType: string;
  provenance: SearchPerformanceCase["provenance"];
  expectedSourceCount: number;
  foundSourceCount: number;
  firstExpectedRank: number | null;
  successAt10: boolean;
  recallAt10BasisPoints: number;
  reciprocalRankBasisPoints: number;
}

export interface SearchQualitySummary {
  totalCases: number;
  successfulCases: number;
  successAt10BasisPoints: number;
  meanRecallAt10BasisPoints: number;
  meanReciprocalRankBasisPoints: number;
}

export interface SearchTaskTypeComparison {
  taskType: string;
  totalCases: number;
  baselineWins: number;
  candidateWins: number;
  ties: number;
  minimumCandidateWins: 1;
  maximumBaselineWins: 0;
  comparisonState: "passed" | "failed";
  baselineRankingWins: number;
  candidateRankingWins: number;
  rankingTies: number;
  recallAt10DeltaBasisPoints: number;
  reciprocalRankDeltaBasisPoints: number;
}

export interface SearchLatencySummary {
  sampleCount: number;
  p50Nanoseconds: number;
  p95Nanoseconds: number;
}

export interface SearchEnginePerformanceObservation {
  engine: SearchEvaluationIndexPort["engine"];
  adapterBuildId: string;
  quality: SearchQualitySummary;
  cases: SearchQualityCaseObservation[];
  buildLatency: SearchLatencySummary;
  warmQueryLatency: SearchLatencySummary;
}

export interface SearchPerformanceReport {
  schemaVersion: 1;
  reportId: string;
  benchmarkBuildId: string;
  suiteId: string;
  suiteHash: string;
  corpusDigest: string;
  corpusDocumentCount: number;
  corpusByteCount: number;
  evaluatedAt: string;
  protocol: SearchPerformanceProtocol;
  environment: SearchPerformanceEnvironment;
  baseline: SearchEnginePerformanceObservation;
  candidate: SearchEnginePerformanceObservation;
  comparison: {
    taskTypes: SearchTaskTypeComparison[];
    allTaskTypesPassed: boolean;
    additionalSuccesses: number;
    successAt10DeltaBasisPoints: number;
    recallAt10DeltaBasisPoints: number;
    reciprocalRankDeltaBasisPoints: number;
    qualityObservation: "meaningful_gain_observed" | "threshold_not_met";
    rankingObservation:
      | "aggregate_gain_no_case_regression"
      | "aggregate_gain_with_case_regressions"
      | "no_aggregate_gain";
    buildP50RatioBasisPoints: number;
    buildP95RatioBasisPoints: number;
    warmQueryP50RatioBasisPoints: number;
    warmQueryP95RatioBasisPoints: number;
    buildSpeedObservation: "faster" | "comparable" | "slower" | "mixed";
    warmQuerySpeedObservation: "faster" | "comparable" | "slower" | "mixed";
    observedCostAcceptable: boolean;
    adoptionDecision: "not_determined";
  };
  privacy: {
    queryText: "excluded";
    documentPaths: "excluded";
    documentBodies: "excluded";
    suiteQueries: "declared_public_verification_inputs" | "owner_readable_case_records";
  };
}

type Clock = () => bigint;

function basisPoints(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator * 10_000) / denominator);
}

function validateCases(cases: readonly SearchPerformanceCase[]): SearchPerformanceCase[] {
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > 64) {
    throw new SearchError("invalid_evaluation_engine", "The performance case count is invalid.");
  }
  const seen = new Set<string>();
  const validated = cases.map((item) => {
    if (
      !CASE_ID.test(item.caseId) ||
      seen.has(item.caseId) ||
      !TASK_TYPE.test(item.taskType) ||
      !["human_reviewed", "verification_authored"].includes(item.provenance) ||
      typeof item.query !== "string" ||
      item.query.length < 1 ||
      item.query.length > 500 ||
      item.maximumRank !== 10 ||
      !Array.isArray(item.expectedSources) ||
      item.expectedSources.length < 1 ||
      item.expectedSources.length > 8
    ) {
      throw new SearchError("invalid_evaluation_engine", "A performance case is invalid.");
    }
    seen.add(item.caseId);
    const expected = new Set(
      item.expectedSources.map(
        (source: SearchPerformanceCase["expectedSources"][number]) =>
          `${source.kind}:${source.sourceId}`,
      ),
    );
    if (expected.size !== item.expectedSources.length) {
      throw new SearchError("invalid_evaluation_engine", "Expected performance sources repeat.");
    }
    return structuredClone(item);
  });
  const counts = new Map<string, number>();
  for (const item of validated) counts.set(item.taskType, (counts.get(item.taskType) ?? 0) + 1);
  if (counts.size < 1 || [...counts.values()].some((count) => count < 5)) {
    throw new SearchError(
      "invalid_evaluation_engine",
      "Every performance task type requires at least five cases.",
    );
  }
  return validated.sort((left, right) => left.caseId.localeCompare(right.caseId));
}

async function quality(
  index: SearchEvaluationIndexPort,
  cases: readonly SearchPerformanceCase[],
): Promise<{ cases: SearchQualityCaseObservation[]; summary: SearchQualitySummary }> {
  const observations: SearchQualityCaseObservation[] = [];
  for (const item of cases) {
    const response = await index.search(item.query, SEARCH_MAX_RESULTS);
    if (
      response.indexId !== index.indexId ||
      !sameSearchEngine(response.engine, index.engine) ||
      response.requestedLimit !== SEARCH_MAX_RESULTS
    ) {
      throw new SearchError("invalid_evaluation_engine", "A benchmark response is inconsistent.");
    }
    const ranks = item.expectedSources.map((expected) => {
      const hit = response.hits.find(
        (candidate) =>
          candidate.source.kind === expected.kind &&
          candidate.source.sourceId === expected.sourceId,
      );
      return hit?.rank ?? null;
    });
    const within = ranks.filter((rank): rank is number => rank !== null && rank <= 10);
    const firstExpectedRank = within.length === 0 ? null : Math.min(...within);
    observations.push({
      caseId: item.caseId,
      taskType: item.taskType,
      provenance: item.provenance,
      expectedSourceCount: item.expectedSources.length,
      foundSourceCount: within.length,
      firstExpectedRank,
      successAt10: within.length > 0,
      recallAt10BasisPoints: basisPoints(within.length, item.expectedSources.length),
      reciprocalRankBasisPoints:
        firstExpectedRank === null ? 0 : Math.round(10_000 / firstExpectedRank),
    });
  }
  const successfulCases = observations.filter((item) => item.successAt10).length;
  return {
    cases: observations,
    summary: {
      totalCases: observations.length,
      successfulCases,
      successAt10BasisPoints: basisPoints(successfulCases, observations.length),
      meanRecallAt10BasisPoints: Math.round(
        observations.reduce((sum, item) => sum + item.recallAt10BasisPoints, 0) /
          observations.length,
      ),
      meanReciprocalRankBasisPoints: Math.round(
        observations.reduce((sum, item) => sum + item.reciprocalRankBasisPoints, 0) /
          observations.length,
      ),
    },
  };
}

function duration(start: bigint, end: bigint): number {
  const value = end - start;
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new SearchError("invalid_evaluation_engine", "A benchmark clock result is invalid.");
  }
  return Number(value);
}

async function timed<T>(clock: Clock, operation: () => Promise<T> | T): Promise<[T, number]> {
  const start = clock();
  const value = await operation();
  return [value, duration(start, clock())];
}

function percentile(samples: readonly number[], quantile: number): number {
  if (samples.length === 0) {
    throw new SearchError("invalid_evaluation_engine", "A latency sample set is empty.");
  }
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * quantile) - 1]!;
}

function latency(samples: readonly number[]): SearchLatencySummary {
  return {
    sampleCount: samples.length,
    p50Nanoseconds: percentile(samples, 0.5),
    p95Nanoseconds: percentile(samples, 0.95),
  };
}

function ratio(candidate: number, baseline: number): number {
  return baseline === 0
    ? candidate === 0
      ? 10_000
      : Number.MAX_SAFE_INTEGER
    : basisPoints(candidate, baseline);
}

function speed(p50: number, p95: number): "faster" | "comparable" | "slower" | "mixed" {
  if (p50 <= 9_000 && p95 <= 9_000) return "faster";
  if (p50 >= 11_000 && p95 >= 11_000) return "slower";
  if (p50 >= 9_000 && p50 <= 11_000 && p95 >= 9_000 && p95 <= 11_000) return "comparable";
  return "mixed";
}

export function currentSearchPerformanceEnvironment(): SearchPerformanceEnvironment {
  const processors = cpus();
  return {
    platform: platform(),
    release: release(),
    architecture: process.arch,
    processor: processors[0]?.model ?? "unknown",
    logicalProcessorCount: processors.length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    runtime: process.version,
    runtimeFlags: [...process.execArgv],
    hostnameDigest: canonicalHash(hostname()),
    powerMode: "unobserved",
    competingWorkloads: "unobserved",
  };
}

export async function runSearchPerformanceBenchmark(input: {
  suiteId: string;
  suiteHash: string;
  suiteQueries: SearchPerformanceReport["privacy"]["suiteQueries"];
  corpus: readonly SearchSourceInput[];
  corpusByteCount: number;
  cases: readonly SearchPerformanceCase[];
  baselineEngine: SearchEvaluationEnginePort;
  candidateEngine: SearchEvaluationEnginePort;
  evaluatedAt: Date;
  environment: SearchPerformanceEnvironment;
  protocol?: SearchPerformanceProtocol;
  clock?: Clock;
}): Promise<SearchPerformanceReport> {
  const cases = validateCases(input.cases);
  const corpus = prepareSearchCorpus(input.corpus);
  const protocol = input.protocol ?? {
    buildWarmupPairs: 5,
    buildRecordedPairs: 30,
    queryWarmupPasses: 5,
    queryRecordedRepetitions: 30,
    requestedLimit: 50,
  };
  if (
    !/^spbench_[a-z0-9][a-z0-9_.-]{2,95}$/u.test(input.suiteId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.suiteHash) ||
    !Number.isSafeInteger(input.corpusByteCount) ||
    input.corpusByteCount < 1 ||
    !Number.isFinite(input.evaluatedAt.getTime()) ||
    Object.values(protocol).some((value) => !Number.isSafeInteger(value) || value < 1) ||
    protocol.requestedLimit !== SEARCH_MAX_RESULTS
  ) {
    throw new SearchError(
      "invalid_evaluation_engine",
      "The performance benchmark input is invalid.",
    );
  }
  assertSearchEngineIdentity(input.baselineEngine.engine);
  assertSearchEngineIdentity(input.candidateEngine.engine);
  assertSearchAdapterBuildId(input.baselineEngine.adapterBuildId, "invalid_evaluation_engine");
  assertSearchAdapterBuildId(input.candidateEngine.adapterBuildId, "invalid_evaluation_engine");
  if (sameSearchEngine(input.baselineEngine.engine, input.candidateEngine.engine)) {
    throw new SearchError("invalid_evaluation_engine", "Benchmark engines must be distinct.");
  }
  const clock = input.clock ?? process.hrtime.bigint;
  const buildSamples = { baseline: [] as number[], candidate: [] as number[] };
  const build = async (engine: SearchEvaluationEnginePort): Promise<SearchEvaluationIndexPort> =>
    engine.buildIndex(corpus.sources);
  for (let pair = 0; pair < protocol.buildWarmupPairs; pair += 1) {
    const order =
      pair % 2 === 0
        ? [input.baselineEngine, input.candidateEngine]
        : [input.candidateEngine, input.baselineEngine];
    for (const engine of order) await build(engine);
  }
  for (let pair = 0; pair < protocol.buildRecordedPairs; pair += 1) {
    const order =
      pair % 2 === 0
        ? [input.baselineEngine, input.candidateEngine]
        : [input.candidateEngine, input.baselineEngine];
    for (const engine of order) {
      const [, elapsed] = await timed(clock, () => build(engine));
      (sameSearchEngine(engine.engine, input.baselineEngine.engine)
        ? buildSamples.baseline
        : buildSamples.candidate
      ).push(elapsed);
    }
  }
  const baselineIndex = await build(input.baselineEngine);
  const candidateIndex = await build(input.candidateEngine);
  const baselineQuality = await quality(baselineIndex, cases);
  const candidateQuality = await quality(candidateIndex, cases);
  const querySamples = { baseline: [] as number[], candidate: [] as number[] };
  const queryPass = async (record: boolean, repetition: number): Promise<void> => {
    const rotated = [
      ...cases.slice(repetition % cases.length),
      ...cases.slice(0, repetition % cases.length),
    ];
    const engineOrder =
      repetition % 2 === 0
        ? ([
            [baselineIndex, querySamples.baseline],
            [candidateIndex, querySamples.candidate],
          ] as const)
        : ([
            [candidateIndex, querySamples.candidate],
            [baselineIndex, querySamples.baseline],
          ] as const);
    for (const [index, samples] of engineOrder) {
      for (const item of rotated) {
        const [, elapsed] = await timed(clock, () => index.search(item.query, SEARCH_MAX_RESULTS));
        if (record) samples.push(elapsed);
      }
    }
  };
  for (let pass = 0; pass < protocol.queryWarmupPasses; pass += 1) await queryPass(false, pass);
  for (let repetition = 0; repetition < protocol.queryRecordedRepetitions; repetition += 1) {
    await queryPass(true, repetition);
  }
  const taskTypes = [...new Set(cases.map((item) => item.taskType))].sort().map((taskType) => {
    const caseIds = new Set(
      cases.filter((item) => item.taskType === taskType).map((item) => item.caseId),
    );
    const baseline = baselineQuality.cases.filter((item) => caseIds.has(item.caseId));
    const candidate = candidateQuality.cases.filter((item) => caseIds.has(item.caseId));
    const baselineWins = baseline.filter(
      (item, index) => item.successAt10 && !candidate[index]!.successAt10,
    ).length;
    const candidateWins = candidate.filter(
      (item, index) => item.successAt10 && !baseline[index]!.successAt10,
    ).length;
    const ranking = baseline.map((item, index) => {
      const candidateItem = candidate[index]!;
      if (item.foundSourceCount !== candidateItem.foundSourceCount) {
        return item.foundSourceCount > candidateItem.foundSourceCount ? "baseline" : "candidate";
      }
      if (item.firstExpectedRank !== candidateItem.firstExpectedRank) {
        if (item.firstExpectedRank === null) return "candidate";
        if (candidateItem.firstExpectedRank === null) return "baseline";
        return item.firstExpectedRank < candidateItem.firstExpectedRank ? "baseline" : "candidate";
      }
      return "tie";
    });
    return {
      taskType,
      totalCases: caseIds.size,
      baselineWins,
      candidateWins,
      ties: caseIds.size - baselineWins - candidateWins,
      minimumCandidateWins: 1 as const,
      maximumBaselineWins: 0 as const,
      comparisonState:
        candidateWins >= 1 && baselineWins === 0 ? ("passed" as const) : ("failed" as const),
      baselineRankingWins: ranking.filter((item) => item === "baseline").length,
      candidateRankingWins: ranking.filter((item) => item === "candidate").length,
      rankingTies: ranking.filter((item) => item === "tie").length,
      recallAt10DeltaBasisPoints:
        Math.round(
          candidate.reduce((sum, item) => sum + item.recallAt10BasisPoints, 0) / candidate.length,
        ) -
        Math.round(
          baseline.reduce((sum, item) => sum + item.recallAt10BasisPoints, 0) / baseline.length,
        ),
      reciprocalRankDeltaBasisPoints:
        Math.round(
          candidate.reduce((sum, item) => sum + item.reciprocalRankBasisPoints, 0) /
            candidate.length,
        ) -
        Math.round(
          baseline.reduce((sum, item) => sum + item.reciprocalRankBasisPoints, 0) / baseline.length,
        ),
    };
  });
  const baselineBuild = latency(buildSamples.baseline);
  const candidateBuild = latency(buildSamples.candidate);
  const baselineQuery = latency(querySamples.baseline);
  const candidateQuery = latency(querySamples.candidate);
  const buildP50RatioBasisPoints = ratio(
    candidateBuild.p50Nanoseconds,
    baselineBuild.p50Nanoseconds,
  );
  const buildP95RatioBasisPoints = ratio(
    candidateBuild.p95Nanoseconds,
    baselineBuild.p95Nanoseconds,
  );
  const warmQueryP50RatioBasisPoints = ratio(
    candidateQuery.p50Nanoseconds,
    baselineQuery.p50Nanoseconds,
  );
  const warmQueryP95RatioBasisPoints = ratio(
    candidateQuery.p95Nanoseconds,
    baselineQuery.p95Nanoseconds,
  );
  const additionalSuccesses =
    candidateQuality.summary.successfulCases - baselineQuality.summary.successfulCases;
  const successAt10DeltaBasisPoints =
    candidateQuality.summary.successAt10BasisPoints -
    baselineQuality.summary.successAt10BasisPoints;
  const recallAt10DeltaBasisPoints =
    candidateQuality.summary.meanRecallAt10BasisPoints -
    baselineQuality.summary.meanRecallAt10BasisPoints;
  const reciprocalRankDeltaBasisPoints =
    candidateQuality.summary.meanReciprocalRankBasisPoints -
    baselineQuality.summary.meanReciprocalRankBasisPoints;
  const aggregateRankingGain =
    (recallAt10DeltaBasisPoints > 0 && reciprocalRankDeltaBasisPoints >= 0) ||
    (recallAt10DeltaBasisPoints >= 0 && reciprocalRankDeltaBasisPoints > 0);
  const core = {
    benchmarkBuildId: SEARCH_PERFORMANCE_BENCHMARK_BUILD_ID,
    suiteId: input.suiteId,
    suiteHash: input.suiteHash,
    corpusDigest: corpus.corpusDigest,
    corpusDocumentCount: corpus.sources.length,
    corpusByteCount: input.corpusByteCount,
    evaluatedAt: input.evaluatedAt.toISOString(),
    protocol,
    environment: input.environment,
    baseline: {
      engine: input.baselineEngine.engine,
      adapterBuildId: input.baselineEngine.adapterBuildId,
      quality: baselineQuality.summary,
      cases: baselineQuality.cases,
      buildLatency: baselineBuild,
      warmQueryLatency: baselineQuery,
    },
    candidate: {
      engine: input.candidateEngine.engine,
      adapterBuildId: input.candidateEngine.adapterBuildId,
      quality: candidateQuality.summary,
      cases: candidateQuality.cases,
      buildLatency: candidateBuild,
      warmQueryLatency: candidateQuery,
    },
    comparison: {
      taskTypes,
      allTaskTypesPassed: taskTypes.every((item) => item.comparisonState === "passed"),
      additionalSuccesses,
      successAt10DeltaBasisPoints,
      recallAt10DeltaBasisPoints,
      reciprocalRankDeltaBasisPoints,
      qualityObservation:
        additionalSuccesses >= 2 &&
        successAt10DeltaBasisPoints >= 1_000 &&
        recallAt10DeltaBasisPoints >= 500 &&
        reciprocalRankDeltaBasisPoints >= 0 &&
        taskTypes.every((item) => item.baselineWins === 0)
          ? ("meaningful_gain_observed" as const)
          : ("threshold_not_met" as const),
      rankingObservation: aggregateRankingGain
        ? taskTypes.some((item) => item.baselineRankingWins > 0)
          ? ("aggregate_gain_with_case_regressions" as const)
          : ("aggregate_gain_no_case_regression" as const)
        : ("no_aggregate_gain" as const),
      buildP50RatioBasisPoints,
      buildP95RatioBasisPoints,
      warmQueryP50RatioBasisPoints,
      warmQueryP95RatioBasisPoints,
      buildSpeedObservation: speed(buildP50RatioBasisPoints, buildP95RatioBasisPoints),
      warmQuerySpeedObservation: speed(warmQueryP50RatioBasisPoints, warmQueryP95RatioBasisPoints),
      observedCostAcceptable:
        warmQueryP95RatioBasisPoints <= 15_000 && buildP95RatioBasisPoints <= 30_000,
      adoptionDecision: "not_determined" as const,
    },
    privacy: {
      queryText: "excluded" as const,
      documentPaths: "excluded" as const,
      documentBodies: "excluded" as const,
      suiteQueries: input.suiteQueries,
    },
  };
  return { schemaVersion: 1, reportId: contentId("spreport", core), ...core };
}

export function nanosecondsToMilliseconds(value: number): number {
  return value / NANOSECONDS_PER_MILLISECOND;
}
