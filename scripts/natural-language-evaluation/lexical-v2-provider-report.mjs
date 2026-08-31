import { evaluateLexicalV2ProviderAcceptance } from "./lexical-v2-provider-comparison-contract.mjs";

export function summarizeLexicalV2ProviderRuns(runs, arm) {
  const observations = runs.map((item) => item.arms[arm]);
  const usage = observations.map((item) => item.usage).filter((item) => item !== null);
  const preparation = observations.filter(
    (item) => item.providerPreparationDurationMs !== undefined,
  );
  return {
    observations: observations.length,
    passed: observations.filter((item) => item.passed).length,
    casesPassingEveryRepetition: [...new Set(runs.map((item) => item.caseId))].filter((caseId) =>
      runs.filter((item) => item.caseId === caseId).every((item) => item.arms[arm].passed),
    ).length,
    expectedPathRecall:
      observations.length === 0
        ? 0
        : observations.reduce((sum, item) => sum + item.expectedPathRecall, 0) /
          observations.length,
    returnedPathPrecision:
      observations.length === 0
        ? 0
        : observations.reduce((sum, item) => sum + item.returnedPathPrecision, 0) /
          observations.length,
    failedContracts: observations.filter((item) => !item.passedContract).length,
    toolOrCommandObservations: observations.filter(
      (item) => item.completedToolCalls > 0 || item.completedCommands > 0,
    ).length,
    providerErrors: observations.reduce((sum, item) => sum + item.providerErrors, 0),
    totalDurationMs: observations.reduce((sum, item) => sum + item.durationMs, 0),
    totalTokens: usage.reduce((sum, item) => sum + item.totalTokens, 0),
    usageObserved: usage.length,
    totalInjectedBytes: observations.reduce((sum, item) => sum + item.injectedBytes, 0),
    structuredOutputRequested: observations.filter((item) => item.structuredOutputRequested).length,
    ...(preparation.length === 0
      ? {}
      : {
          providerPreparationObserved: preparation.length,
          totalProviderPreparationDurationMs: preparation.reduce(
            (sum, item) => sum + item.providerPreparationDurationMs,
            0,
          ),
        }),
  };
}

export function createLexicalV2ProviderReport(input) {
  const summary = {
    lexicalV1: summarizeLexicalV2ProviderRuns(input.runs, "lexical_v1"),
    lexicalV2: summarizeLexicalV2ProviderRuns(input.runs, "lexical_v2"),
  };
  return {
    schemaVersion: 1,
    reportKind: "lexical_v2_provider_comparison",
    suiteId: input.suiteId,
    suiteDigest: input.suiteDigest,
    provider: input.provider,
    model: input.model,
    repositorySnapshot: input.repositorySnapshot,
    corpusDigest: input.corpusDigest,
    observedAt: input.observedAt,
    privacy: {
      queries: "checked_in_public",
      answers: "digest_only",
      sourceBodies: "excluded",
      absolutePaths: "excluded",
    },
    summary,
    acceptance: input.acceptance,
    decision: evaluateLexicalV2ProviderAcceptance(input.acceptance, summary, input.runs),
    runs: input.runs,
  };
}
