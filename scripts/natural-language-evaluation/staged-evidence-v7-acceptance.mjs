import { repeatedRetrievalBasisPointRatio } from "./repeated-retrieval-observation.mjs";

export function evaluateStagedEvidenceV7Acceptance(acceptance, summary) {
  const direct = summary.modelDirect;
  const v7 = summary.stagedEvidenceV7;
  const ratio = (field) => repeatedRetrievalBasisPointRatio(v7[field], direct[field]);
  const tokenRatioToModelDirectBasisPoints = ratio("totalTokens");
  const durationRatioToModelDirectBasisPoints = ratio("totalDurationMs");
  const noHitP95RatioToModelDirectBasisPoints = repeatedRetrievalBasisPointRatio(
    v7.noHitDuration.p95Ms,
    direct.noHitDuration.p95Ms,
  );
  const noHitStandardDeviationRatioToModelDirectBasisPoints = repeatedRetrievalBasisPointRatio(
    v7.noHitDuration.standardDeviationMs,
    direct.noHitDuration.standardDeviationMs,
  );
  const usageComplete =
    direct.usageObservedCases === direct.observations && v7.usageObservedCases === v7.observations;
  const criteria = {
    casesPassingEveryRepetition:
      v7.casesPassingEveryRepetition >= acceptance.minimumCasesPassingEveryRepetition,
    passCountNonInferiority:
      !acceptance.requirePassCountNonInferiorityToModelDirect || v7.passed >= direct.passed,
    recallNonInferiority:
      !acceptance.requireRecallNonInferiorityToModelDirect ||
      v7.expectedPathRecall >= direct.expectedPathRecall,
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
    selectionContracts: v7.failedSelectionContracts <= acceptance.maximumFailedSelectionContracts,
    coverageContracts: v7.failedCoverageContracts <= acceptance.maximumFailedCoverageContracts,
    sourceMarkerContracts:
      v7.failedSourceMarkerContracts <= acceptance.maximumFailedSourceMarkerContracts,
    responseContracts: v7.failedResponseContracts <= acceptance.maximumFailedResponseContracts,
    relevantRecommendations:
      v7.droppedRelevantRecommendations <= acceptance.maximumDroppedRelevantRecommendations,
    relevantCoverageSources:
      v7.droppedRelevantCoverageSources <= acceptance.maximumDroppedRelevantCoverageSources,
    relevantNoHitCandidates:
      v7.droppedRelevantNoHitCandidates <= acceptance.maximumDroppedRelevantNoHitCandidates,
    providerExecutions: v7.providerExecutionFailures <= acceptance.maximumFailedContracts,
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
