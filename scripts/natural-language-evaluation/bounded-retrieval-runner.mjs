import {
  delegatedRetrievalDigest,
  validateDelegatedRetrievalSuite,
} from "./delegated-retrieval-contract.mjs";
import {
  delegatedRetrievalProtocol,
  runDelegatedRetrievalArm,
} from "./delegated-retrieval-runner.mjs";

const fallbackInstructions = {
  lexical_only: [],
  lexical_no_hits: [
    "Fallback reason: lexical-v1 returned no recommendations.",
    "You MUST inspect the repository with read-only tools before answering.",
  ],
  impact_verification: [
    "Fallback reason: the question asks for impact across repository boundaries.",
    "Lexical recommendations are candidates only. You MUST independently inspect the repository and verify every relevant canonical source before answering.",
  ],
  approval_boundary_verification: [
    "Fallback reason: the question asks about an approval or ownership boundary.",
    "Lexical recommendations are candidates only. You MUST independently inspect the repository and verify every relevant canonical source before answering.",
  ],
};

export function boundedFallbackProtocol(trigger) {
  const instructions = fallbackInstructions[trigger];
  if (instructions === undefined) throw new TypeError("The bounded fallback trigger is invalid.");
  return [delegatedRetrievalProtocol, ...instructions].join("\n");
}

export function validateFallbackRecommendations(trigger, recommendations) {
  const hasRecommendations = recommendations.length > 0;
  if ((trigger === "lexical_no_hits") !== !hasRecommendations) {
    throw new TypeError("The bounded fallback trigger contradicts the lexical result.");
  }
}

function boundedFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("timed out")) return "provider_timeout";
  if (
    message.includes("JSON object") ||
    message.includes("answer contract") ||
    message.includes("adapter coordinates")
  ) {
    return "provider_result_invalid";
  }
  return "provider_execution_failed";
}

async function runBoundedArm(input) {
  const startedAt = Date.now();
  try {
    const result = await runDelegatedRetrievalArm(input);
    const fallbackTriggerSatisfied =
      input.arm !== "bounded_fallback" ||
      input.fallbackTrigger === "lexical_only" ||
      result.repositoryInspectionObserved;
    return {
      ...result,
      passed: result.answerPassed && fallbackTriggerSatisfied,
      fallbackTrigger: input.fallbackTrigger ?? null,
      fallbackTriggerSatisfied,
    };
  } catch (error) {
    return {
      arm: input.arm,
      passedContract: false,
      passed: false,
      answerPassed: false,
      expectedPathRecall: 0,
      returnedPathPrecision: 0,
      abstained: false,
      durationMs: Date.now() - startedAt,
      completedToolCalls: 0,
      completedCommands: 0,
      providerErrors: 1,
      usage: null,
      repositoryInspectionObserved: false,
      fallbackTrigger: input.fallbackTrigger ?? null,
      fallbackTriggerSatisfied: input.arm !== "bounded_fallback",
      injectedRecommendationPaths: [],
      failureCode: boundedFailureCode(error),
    };
  }
}

function basisPointRatio(numerator, denominator) {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000);
}

export function evaluateFallbackAcceptance(acceptance, summary) {
  const direct = summary.modelDirect;
  const fallback = summary.boundedFallback;
  const tokenRatioToModelDirectBasisPoints = basisPointRatio(
    fallback.totalTokens,
    direct.totalTokens,
  );
  const durationRatioToModelDirectBasisPoints = basisPointRatio(
    fallback.totalDurationMs,
    direct.totalDurationMs,
  );
  const usageComplete =
    direct.usageObservedCases === direct.observations &&
    fallback.usageObservedCases === fallback.observations;
  const criteria = {
    casesPassingEveryRepetition:
      fallback.casesPassingEveryRepetition >= acceptance.minimumCasesPassingEveryRepetition,
    passCountNonInferiority:
      !acceptance.requirePassCountNonInferiorityToModelDirect || fallback.passed >= direct.passed,
    recallNonInferiority:
      !acceptance.requireRecallNonInferiorityToModelDirect ||
      fallback.expectedPathRecall >= direct.expectedPathRecall,
    tokenRatio:
      usageComplete &&
      tokenRatioToModelDirectBasisPoints !== null &&
      tokenRatioToModelDirectBasisPoints <= acceptance.maximumTokenRatioToModelDirectBasisPoints,
    durationRatio:
      durationRatioToModelDirectBasisPoints !== null &&
      durationRatioToModelDirectBasisPoints <=
        acceptance.maximumDurationRatioToModelDirectBasisPoints,
    fallbackTriggers: fallback.failedFallbackTriggers <= acceptance.maximumFailedFallbackTriggers,
    providerContracts: fallback.failedContracts <= acceptance.maximumFailedContracts,
  };
  return {
    passed: Object.values(criteria).every(Boolean),
    criteria,
    observed: {
      tokenRatioToModelDirectBasisPoints,
      durationRatioToModelDirectBasisPoints,
      usageComplete,
    },
  };
}

function summarizeBoundedRuns(runs, arm) {
  const selected = runs.map((item) => item.arms[arm]);
  const usage = selected.map((item) => item.usage).filter((item) => item !== null);
  const caseIds = [...new Set(runs.map((item) => item.caseId))];
  return {
    observations: selected.length,
    passed: selected.filter((item) => item.passed).length,
    casesPassingEveryRepetition: caseIds.filter((caseId) =>
      runs.filter((item) => item.caseId === caseId).every((item) => item.arms[arm].passed),
    ).length,
    expectedPathRecall:
      selected.reduce((sum, item) => sum + item.expectedPathRecall, 0) / selected.length,
    returnedPathPrecision:
      selected.reduce((sum, item) => sum + item.returnedPathPrecision, 0) / selected.length,
    failedContracts: selected.filter((item) => !item.passedContract).length,
    failedFallbackTriggers: selected.filter((item) => !item.fallbackTriggerSatisfied).length,
    totalDurationMs: selected.reduce((sum, item) => sum + item.durationMs, 0),
    meanDurationMs: selected.reduce((sum, item) => sum + item.durationMs, 0) / selected.length,
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

export async function runBoundedFallbackBenchmark(input) {
  const suite = validateDelegatedRetrievalSuite(input.suite);
  if (suite.suiteId !== "drbench_bounded_fallback.v1") {
    throw new TypeError("The bounded fallback runner requires its versioned suite.");
  }
  const corpus = await input.loadCorpus(input.repositoryRoot, suite);
  const runs = [];
  const armNames = ["model_direct", "lexical_assisted", "bounded_fallback"];
  for (let repetition = 1; repetition <= suite.repetitionsPerArm; repetition += 1) {
    for (const [index, item] of suite.cases.entries()) {
      const recommendations = input.searchLexical(corpus, item.query, suite.lexicalLimit);
      validateFallbackRecommendations(item.fallbackTrigger, recommendations);
      const offset = (index + repetition - 1) % armNames.length;
      const order = [...armNames.slice(offset), ...armNames.slice(0, offset)];
      const arms = {};
      for (const arm of order) {
        input.onProgress?.({ caseId: item.caseId, arm, repetition });
        arms[arm] = await runBoundedArm({
          ...input,
          item,
          arm,
          recommendations,
          fallbackTrigger: arm === "bounded_fallback" ? item.fallbackTrigger : null,
          protocol:
            arm === "bounded_fallback"
              ? boundedFallbackProtocol(item.fallbackTrigger)
              : delegatedRetrievalProtocol,
        });
      }
      runs.push({
        caseId: item.caseId,
        taskType: item.taskType,
        repetition,
        fallbackTrigger: item.fallbackTrigger,
        expectedPaths: item.expectedPaths,
        lexicalRecommendationPaths: recommendations.map((source) => source.path),
        armOrder: order,
        arms,
      });
    }
  }
  const report = {
    schemaVersion: 1,
    reportKind: "bounded_retrieval_fallback_observation",
    suiteId: suite.suiteId,
    suiteDigest: delegatedRetrievalDigest(suite),
    provider: input.provider,
    model: input.model,
    repositorySnapshot: input.repositorySnapshot,
    corpusDigest: input.corpusDigest(corpus),
    observedAt: new Date().toISOString(),
    repetitionsPerArm: suite.repetitionsPerArm,
    policy: {
      policyId: "lexical-first-bounded-fallback-v1",
      triggers: ["lexical_no_hits", "impact_verification", "approval_boundary_verification"],
      failureMeanings: [
        "provider_timeout",
        "provider_result_invalid",
        "provider_execution_failed",
        "fallback_trigger_not_observed",
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
    modelDirect: summarizeBoundedRuns(runs, "model_direct"),
    lexicalAssisted: summarizeBoundedRuns(runs, "lexical_assisted"),
    boundedFallback: summarizeBoundedRuns(runs, "bounded_fallback"),
  };
  report.acceptance = suite.acceptance;
  report.decision = evaluateFallbackAcceptance(suite.acceptance, report.summary);
  return report;
}
