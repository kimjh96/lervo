import { delegatedRetrievalDigest } from "./delegated-retrieval-contract.mjs";
import {
  delegatedRetrievalProtocol,
  runDelegatedRetrievalArm,
} from "./delegated-retrieval-runner.mjs";
import {
  lexicalAssistedV2Protocol,
  lexicalAssistedV2ProtocolDigest,
  parseLexicalAssistedV2EvidenceGap,
  validateLexicalAssistedV2Recommendations,
  validateLexicalAssistedV2Suite,
} from "./lexical-assisted-v2-contract.mjs";

export { lexicalAssistedV2Protocol };

function failureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("timed out")) return "provider_timeout";
  if (
    message.includes("JSON object") ||
    message.includes("answer contract") ||
    message.includes("evidence-gap") ||
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
    if (input.arm !== "lexical_assisted_v2") {
      return {
        ...result,
        passed: result.answerPassed,
        groundedAnswerPassed: result.answerPassed,
        evidenceGapContractSatisfied: true,
        relevantRecommendationPaths: [],
        droppedRelevantRecommendationPaths: [],
      };
    }
    const evidenceGap = result.protocolObservation;
    const gapNamed = evidenceGap.status === "named";
    const noHits = input.recommendations.length === 0;
    const evidenceGapContractSatisfied =
      gapNamed === result.repositoryInspectionObserved &&
      (!noHits || (gapNamed && evidenceGap.code === "lexical_no_hits"));
    const recommendationPaths = new Set(input.recommendations.map((source) => source.path));
    const relevantRecommendationPaths = input.item.expectedPaths.filter((path) =>
      recommendationPaths.has(path),
    );
    const returnedPaths = new Set(result.sourcePaths);
    const droppedRelevantRecommendationPaths = relevantRecommendationPaths.filter(
      (path) => !returnedPaths.has(path),
    );
    const groundedAnswerPassed =
      result.answerPassed &&
      evidenceGapContractSatisfied &&
      droppedRelevantRecommendationPaths.length === 0;
    return {
      ...result,
      passed: groundedAnswerPassed,
      groundedAnswerPassed,
      evidenceGapContractSatisfied,
      relevantRecommendationPaths,
      droppedRelevantRecommendationPaths,
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
      evidenceGapContractSatisfied: input.arm !== "lexical_assisted_v2",
      relevantRecommendationPaths: [],
      droppedRelevantRecommendationPaths: [],
      injectedRecommendationPaths: [],
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
    failedEvidenceGapContracts: selected.filter((item) => !item.evidenceGapContractSatisfied)
      .length,
    droppedRelevantRecommendations: selected.reduce(
      (sum, item) => sum + item.droppedRelevantRecommendationPaths.length,
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

export function evaluateLexicalAssistedV2Acceptance(acceptance, summary) {
  const direct = summary.modelDirect;
  const v2 = summary.lexicalAssistedV2;
  const tokenRatioToModelDirectBasisPoints = basisPointRatio(v2.totalTokens, direct.totalTokens);
  const durationRatioToModelDirectBasisPoints = basisPointRatio(
    v2.totalDurationMs,
    direct.totalDurationMs,
  );
  const noHitP95RatioToModelDirectBasisPoints = basisPointRatio(
    v2.noHitDuration.p95Ms,
    direct.noHitDuration.p95Ms,
  );
  const noHitStandardDeviationRatioToModelDirectBasisPoints = basisPointRatio(
    v2.noHitDuration.standardDeviationMs,
    direct.noHitDuration.standardDeviationMs,
  );
  const usageComplete =
    direct.usageObservedCases === direct.observations && v2.usageObservedCases === v2.observations;
  const criteria = {
    casesPassingEveryRepetition:
      v2.casesPassingEveryRepetition >= acceptance.minimumCasesPassingEveryRepetition,
    passCountNonInferiority:
      !acceptance.requirePassCountNonInferiorityToModelDirect || v2.passed >= direct.passed,
    recallNonInferiority:
      !acceptance.requireRecallNonInferiorityToModelDirect ||
      v2.expectedPathRecall >= direct.expectedPathRecall,
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
    evidenceGapContracts:
      v2.failedEvidenceGapContracts <= acceptance.maximumFailedEvidenceGapContracts,
    relevantRecommendations:
      v2.droppedRelevantRecommendations <= acceptance.maximumDroppedRelevantRecommendations,
    providerContracts: v2.failedContracts <= acceptance.maximumFailedContracts,
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

export async function runLexicalAssistedV2Benchmark(input) {
  const suite = validateLexicalAssistedV2Suite(input.suite);
  const corpus = await input.loadCorpus(input.repositoryRoot, suite);
  const runs = [];
  const armNames = ["model_direct", "lexical_assisted_v1", "lexical_assisted_v2"];
  for (let repetition = 1; repetition <= suite.repetitionsPerArm; repetition += 1) {
    for (const [index, item] of suite.cases.entries()) {
      const recommendations = input.searchLexical(corpus, item.query, suite.lexicalLimit);
      validateLexicalAssistedV2Recommendations(item, recommendations);
      const offset = (index + repetition - 1) % armNames.length;
      const order = [...armNames.slice(offset), ...armNames.slice(0, offset)];
      const arms = {};
      for (const arm of order) {
        input.onProgress?.({ caseId: item.caseId, arm, repetition });
        arms[arm] = await runArm({
          ...input,
          item,
          arm,
          recommendations,
          protocol:
            arm === "lexical_assisted_v2" ? lexicalAssistedV2Protocol : delegatedRetrievalProtocol,
          ...(arm === "lexical_assisted_v2"
            ? { observeAnswer: parseLexicalAssistedV2EvidenceGap }
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
    reportKind: "lexical_assisted_v2_observation",
    suiteId: suite.suiteId,
    suiteDigest: delegatedRetrievalDigest(suite),
    provider: input.provider,
    model: input.model,
    repositorySnapshot: input.repositorySnapshot,
    corpusDigest: input.corpusDigest(corpus),
    observedAt: new Date().toISOString(),
    repetitionsPerArm: suite.repetitionsPerArm,
    policy: {
      policyId: "lexical-assisted-evidence-gap-v2",
      protocolDigest: lexicalAssistedV2ProtocolDigest,
      explorationTrigger: "provider_named_evidence_gap_or_lexical_no_hits",
      relevantRecommendationRule: "expected_path_intersection",
      failureMeanings: [
        "provider_timeout",
        "provider_result_invalid",
        "provider_execution_failed",
        "evidence_gap_contract_failed",
        "relevant_recommendation_dropped",
      ],
    },
    privacy: {
      queries: "checked_in_public",
      answers: "operator_output_only",
      sourceBodies: "excluded",
      absolutePaths: "excluded",
    },
    summary: {},
    runs,
  };
  report.summary = {
    modelDirect: summarizeRuns(runs, "model_direct"),
    lexicalAssistedV1: summarizeRuns(runs, "lexical_assisted_v1"),
    lexicalAssistedV2: summarizeRuns(runs, "lexical_assisted_v2"),
  };
  report.acceptance = suite.acceptance;
  report.decision = evaluateLexicalAssistedV2Acceptance(suite.acceptance, report.summary);
  return report;
}
