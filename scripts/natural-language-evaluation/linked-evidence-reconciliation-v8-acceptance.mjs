import { repeatedRetrievalBasisPointRatio } from "./repeated-retrieval-observation.mjs";

export function evaluateLinkedEvidenceReconciliationV8Acceptance(acceptance, summary) {
  const direct = summary.modelDirect;
  const v8 = summary.linkedEvidenceReconciliationV8;
  const ratio = (field) => repeatedRetrievalBasisPointRatio(v8[field], direct[field]);
  const tokenRatioToModelDirectBasisPoints = ratio("totalTokens");
  const durationRatioToModelDirectBasisPoints = ratio("totalDurationMs");
  const noHitP95RatioToModelDirectBasisPoints = repeatedRetrievalBasisPointRatio(
    v8.noHitDuration.p95Ms,
    direct.noHitDuration.p95Ms,
  );
  const noHitStandardDeviationRatioToModelDirectBasisPoints = repeatedRetrievalBasisPointRatio(
    v8.noHitDuration.standardDeviationMs,
    direct.noHitDuration.standardDeviationMs,
  );
  const usageComplete =
    direct.usageObservedCases === direct.observations && v8.usageObservedCases === v8.observations;
  const criteria = {
    casesPassingEveryRepetition:
      v8.casesPassingEveryRepetition >= acceptance.minimumCasesPassingEveryRepetition,
    passCountNonInferiority:
      !acceptance.requirePassCountNonInferiorityToModelDirect || v8.passed >= direct.passed,
    recallNonInferiority:
      !acceptance.requireRecallNonInferiorityToModelDirect ||
      v8.expectedPathRecall >= direct.expectedPathRecall,
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
    selectionContracts: v8.failedSelectionContracts <= acceptance.maximumFailedSelectionContracts,
    coverageContracts: v8.failedCoverageContracts <= acceptance.maximumFailedCoverageContracts,
    reconciliationContracts:
      v8.failedReconciliationContracts <= acceptance.maximumFailedReconciliationContracts,
    sourceMarkerContracts:
      v8.failedSourceMarkerContracts <= acceptance.maximumFailedSourceMarkerContracts,
    responseContracts: v8.failedResponseContracts <= acceptance.maximumFailedResponseContracts,
    relevantRecommendations:
      v8.droppedRelevantRecommendations <= acceptance.maximumDroppedRelevantRecommendations,
    relevantLinkedSources:
      v8.droppedRelevantLinkedSources <= acceptance.maximumDroppedRelevantLinkedSources,
    relevantCoverageSources:
      v8.droppedRelevantCoverageSources <= acceptance.maximumDroppedRelevantCoverageSources,
    relevantNoHitCandidates:
      v8.droppedRelevantNoHitCandidates <= acceptance.maximumDroppedRelevantNoHitCandidates,
    providerExecutions: v8.providerExecutionFailures <= acceptance.maximumFailedContracts,
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
