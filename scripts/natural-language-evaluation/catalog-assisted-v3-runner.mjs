import { delegatedRetrievalDigest } from "./delegated-retrieval-contract.mjs";
import {
  delegatedRetrievalProtocol,
  runDelegatedRetrievalArm,
} from "./delegated-retrieval-runner.mjs";
import {
  buildCatalogAssistedV3Catalog,
  catalogAssistedV3Protocol,
  catalogAssistedV3ProtocolDigest,
  parseCatalogAssistedV3Coverage,
  validateCatalogAssistedV3Recommendations,
  validateCatalogAssistedV3Suite,
} from "./catalog-assisted-v3-contract.mjs";

export { catalogAssistedV3Protocol };

function failureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("timed out")) return "provider_timeout";
  if (
    message.includes("JSON object") ||
    message.includes("answer contract") ||
    message.includes("coverage-assessment") ||
    message.includes("adapter coordinates")
  ) {
    return "provider_result_invalid";
  }
  return "provider_execution_failed";
}

async function runArm(input) {
  const startedAt = Date.now();
  try {
    const result = await runDelegatedRetrievalArm(input);
    if (input.arm !== "catalog_assisted_v3") {
      return {
        ...result,
        passed: result.answerPassed,
        groundedAnswerPassed: result.answerPassed,
        catalogContractSatisfied: true,
        relevantRecommendationPaths: [],
        droppedRelevantRecommendationPaths: [],
        relevantCatalogCandidatePaths: [],
        droppedRelevantCatalogCandidatePaths: [],
      };
    }
    const assessment = result.protocolObservation;
    const candidatesNamed = assessment.status === "catalog_candidates_named";
    const noHits = input.recommendations.length === 0;
    const catalogContractSatisfied =
      candidatesNamed === result.repositoryInspectionObserved && (!noHits || candidatesNamed);
    const recommendationPaths = new Set(input.recommendations.map((source) => source.path));
    const relevantRecommendationPaths = input.item.expectedPaths.filter((path) =>
      recommendationPaths.has(path),
    );
    const candidatePaths = new Set(assessment.candidatePaths);
    const relevantCatalogCandidatePaths = input.item.expectedPaths.filter((path) =>
      candidatePaths.has(path),
    );
    const returnedPaths = new Set(result.sourcePaths);
    const droppedRelevantRecommendationPaths = relevantRecommendationPaths.filter(
      (path) => !returnedPaths.has(path),
    );
    const droppedRelevantCatalogCandidatePaths = relevantCatalogCandidatePaths.filter(
      (path) => !returnedPaths.has(path),
    );
    const groundedAnswerPassed =
      result.answerPassed &&
      catalogContractSatisfied &&
      droppedRelevantRecommendationPaths.length === 0 &&
      droppedRelevantCatalogCandidatePaths.length === 0;
    return {
      ...result,
      passed: groundedAnswerPassed,
      groundedAnswerPassed,
      catalogContractSatisfied,
      relevantRecommendationPaths,
      droppedRelevantRecommendationPaths,
      relevantCatalogCandidatePaths,
      droppedRelevantCatalogCandidatePaths,
    };
  } catch (error) {
    return {
      arm: input.arm,
      passedContract: false,
      passed: false,
      answerPassed: false,
      groundedAnswerPassed: false,
      expectedPathRecall: 0,
      returnedPathPrecision: 0,
      abstained: false,
      durationMs: Date.now() - startedAt,
      completedToolCalls: 0,
      completedCommands: 0,
      providerErrors: 1,
      usage: null,
      repositoryInspectionObserved: false,
      catalogContractSatisfied: input.arm !== "catalog_assisted_v3",
      relevantRecommendationPaths: [],
      droppedRelevantRecommendationPaths: [],
      relevantCatalogCandidatePaths: [],
      droppedRelevantCatalogCandidatePaths: [],
      injectedRecommendationPaths: [],
      injectedAdditionalDocumentPaths: [],
      failureCode: failureCode(error),
    };
  }
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function populationStandardDeviation(values) {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function latencySummary(values) {
  return {
    observations: values.length,
    meanMs:
      values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    standardDeviationMs: populationStandardDeviation(values),
  };
}

function summarizeRuns(runs, arm) {
  const selected = runs.map((item) => item.arms[arm]);
  const usage = selected.map((item) => item.usage).filter((item) => item !== null);
  const caseIds = [...new Set(runs.map((item) => item.caseId))];
  const noHitDurations = runs
    .filter((item) => item.lexicalRecommendationPaths.length === 0)
    .map((item) => item.arms[arm].durationMs);
  return {
    observations: selected.length,
    passed: selected.filter((item) => item.passed).length,
    groundedAnswersPassed: selected.filter((item) => item.groundedAnswerPassed).length,
    casesPassingEveryRepetition: caseIds.filter((caseId) =>
      runs.filter((item) => item.caseId === caseId).every((item) => item.arms[arm].passed),
    ).length,
    expectedPathRecall:
      selected.reduce((sum, item) => sum + item.expectedPathRecall, 0) / selected.length,
    returnedPathPrecision:
      selected.reduce((sum, item) => sum + item.returnedPathPrecision, 0) / selected.length,
    failedContracts: selected.filter((item) => !item.passedContract).length,
    failedCatalogContracts: selected.filter((item) => !item.catalogContractSatisfied).length,
    droppedRelevantRecommendations: selected.reduce(
      (sum, item) => sum + item.droppedRelevantRecommendationPaths.length,
      0,
    ),
    droppedRelevantCatalogCandidates: selected.reduce(
      (sum, item) => sum + item.droppedRelevantCatalogCandidatePaths.length,
      0,
    ),
    totalDurationMs: selected.reduce((sum, item) => sum + item.durationMs, 0),
    duration: latencySummary(selected.map((item) => item.durationMs)),
    noHitDuration: latencySummary(noHitDurations),
    totalToolCalls: selected.reduce((sum, item) => sum + item.completedToolCalls, 0),
    totalCommands: selected.reduce((sum, item) => sum + item.completedCommands, 0),
    totalTokens: usage.reduce((sum, item) => sum + item.totalTokens, 0),
    meanTokens:
      usage.length === 0
        ? null
        : usage.reduce((sum, item) => sum + item.totalTokens, 0) / usage.length,
    usageObservedCases: usage.length,
  };
}

function basisPointRatio(numerator, denominator) {
  if (numerator === null || denominator === null) return null;
  if (denominator === 0) return numerator === 0 ? 0 : null;
  return Math.round((numerator / denominator) * 10_000);
}

export function evaluateCatalogAssistedV3Acceptance(acceptance, summary) {
  const direct = summary.modelDirect;
  const v3 = summary.catalogAssistedV3;
  const tokenRatioToModelDirectBasisPoints = basisPointRatio(v3.totalTokens, direct.totalTokens);
  const durationRatioToModelDirectBasisPoints = basisPointRatio(
    v3.totalDurationMs,
    direct.totalDurationMs,
  );
  const noHitP95RatioToModelDirectBasisPoints = basisPointRatio(
    v3.noHitDuration.p95Ms,
    direct.noHitDuration.p95Ms,
  );
  const noHitStandardDeviationRatioToModelDirectBasisPoints = basisPointRatio(
    v3.noHitDuration.standardDeviationMs,
    direct.noHitDuration.standardDeviationMs,
  );
  const usageComplete =
    direct.usageObservedCases === direct.observations && v3.usageObservedCases === v3.observations;
  const criteria = {
    casesPassingEveryRepetition:
      v3.casesPassingEveryRepetition >= acceptance.minimumCasesPassingEveryRepetition,
    passCountNonInferiority:
      !acceptance.requirePassCountNonInferiorityToModelDirect || v3.passed >= direct.passed,
    recallNonInferiority:
      !acceptance.requireRecallNonInferiorityToModelDirect ||
      v3.expectedPathRecall >= direct.expectedPathRecall,
    tokenRatio:
      usageComplete &&
      tokenRatioToModelDirectBasisPoints !== null &&
      tokenRatioToModelDirectBasisPoints <= acceptance.maximumTokenRatioToModelDirectBasisPoints,
    durationRatio:
      durationRatioToModelDirectBasisPoints !== null &&
      durationRatioToModelDirectBasisPoints <=
        acceptance.maximumDurationRatioToModelDirectBasisPoints,
    noHitP95Ratio:
      noHitP95RatioToModelDirectBasisPoints !== null &&
      noHitP95RatioToModelDirectBasisPoints <=
        acceptance.maximumNoHitP95RatioToModelDirectBasisPoints,
    noHitStandardDeviationRatio:
      noHitStandardDeviationRatioToModelDirectBasisPoints !== null &&
      noHitStandardDeviationRatioToModelDirectBasisPoints <=
        acceptance.maximumNoHitStandardDeviationRatioToModelDirectBasisPoints,
    catalogContracts: v3.failedCatalogContracts <= acceptance.maximumFailedCatalogContracts,
    relevantRecommendations:
      v3.droppedRelevantRecommendations <= acceptance.maximumDroppedRelevantRecommendations,
    relevantCatalogCandidates:
      v3.droppedRelevantCatalogCandidates <= acceptance.maximumDroppedRelevantCatalogCandidates,
    providerContracts: v3.failedContracts <= acceptance.maximumFailedContracts,
  };
  return {
    passed: Object.values(criteria).every(Boolean),
    criteria,
    observed: {
      tokenRatioToModelDirectBasisPoints,
      durationRatioToModelDirectBasisPoints,
      noHitP95RatioToModelDirectBasisPoints,
      noHitStandardDeviationRatioToModelDirectBasisPoints,
      usageComplete,
    },
  };
}

export async function runCatalogAssistedV3Benchmark(input) {
  const suite = validateCatalogAssistedV3Suite(input.suite);
  const corpus = await input.loadCorpus(input.repositoryRoot, suite);
  const catalog = buildCatalogAssistedV3Catalog(corpus, suite.catalog.maximumBytes);
  const runs = [];
  const armNames = ["model_direct", "catalog_assisted_v3"];
  for (let repetition = 1; repetition <= suite.repetitionsPerArm; repetition += 1) {
    for (const [index, item] of suite.cases.entries()) {
      const recommendations = input.searchLexical(corpus, item.query, suite.lexicalLimit);
      validateCatalogAssistedV3Recommendations(item, recommendations);
      const offset = (index + repetition - 1) % armNames.length;
      const order = [...armNames.slice(offset), ...armNames.slice(0, offset)];
      const arms = {};
      for (const arm of order) {
        input.onProgress?.({ caseId: item.caseId, arm, repetition });
        const recommendationPaths = new Set(recommendations.map((source) => source.path));
        arms[arm] = await runArm({
          ...input,
          item,
          arm,
          recommendations,
          protocol:
            arm === "catalog_assisted_v3" ? catalogAssistedV3Protocol : delegatedRetrievalProtocol,
          ...(arm === "catalog_assisted_v3"
            ? {
                additionalDocuments: [catalog.document],
                observeAnswer: (answer) =>
                  parseCatalogAssistedV3Coverage(answer, catalog.pathSet, recommendationPaths),
              }
            : {}),
        });
      }
      runs.push({
        caseId: item.caseId,
        taskType: item.taskType,
        requestStyle: item.requestStyle,
        repetition,
        expectedPaths: item.expectedPaths,
        lexicalRecommendationPaths: recommendations.map((source) => source.path),
        armOrder: order,
        arms,
      });
    }
  }
  const report = {
    schemaVersion: 1,
    reportKind: "catalog_assisted_v3_observation",
    suiteId: suite.suiteId,
    suiteDigest: delegatedRetrievalDigest(suite),
    provider: input.provider,
    model: input.model,
    repositorySnapshot: input.repositorySnapshot,
    corpusDigest: input.corpusDigest(corpus),
    observedAt: new Date().toISOString(),
    repetitionsPerArm: suite.repetitionsPerArm,
    catalog: {
      format: suite.catalog.format,
      sourceCount: catalog.entries.length,
      byteCount: catalog.byteCount,
      contentHash: catalog.contentHash,
      content: "excluded",
    },
    policy: {
      policyId: "catalog-assisted-coverage-v3",
      protocolDigest: catalogAssistedV3ProtocolDigest,
      explorationTrigger: "named_catalog_candidate_or_lexical_no_hits",
      relevantRecommendationRule: "expected_path_intersection",
      failureMeanings: [
        "provider_timeout",
        "provider_result_invalid",
        "provider_execution_failed",
        "catalog_contract_failed",
        "relevant_recommendation_dropped",
        "relevant_catalog_candidate_dropped",
      ],
    },
    privacy: {
      queries: "checked_in_public",
      answers: "operator_output_only",
      catalog: "repository_paths_and_first_headings_only",
      sourceBodies: "excluded",
      absolutePaths: "excluded",
    },
    summary: {},
    runs,
  };
  report.summary = {
    modelDirect: summarizeRuns(runs, "model_direct"),
    catalogAssistedV3: summarizeRuns(runs, "catalog_assisted_v3"),
  };
  report.acceptance = suite.acceptance;
  report.decision = evaluateCatalogAssistedV3Acceptance(suite.acceptance, report.summary);
  return report;
}
