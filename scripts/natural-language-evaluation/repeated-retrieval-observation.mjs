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

export function summarizeRepeatedRetrievalRuns(runs, arm) {
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
    providerExecutionFailures: selected.filter((item) => item.failureCode !== undefined).length,
    failedSelectionContracts: selected.filter((item) => item.selectionContractSatisfied === false)
      .length,
    failedCoverageContracts: selected.filter((item) => !item.coverageContractSatisfied).length,
    failedReconciliationContracts: selected.filter(
      (item) => item.reconciliationContractSatisfied === false,
    ).length,
    failedReferenceContracts: selected.filter((item) => !item.referenceContractSatisfied).length,
    failedSourceMarkerContracts: selected.filter(
      (item) => item.sourceMarkerContractSatisfied === false,
    ).length,
    failedResponseContracts: selected.filter((item) => item.responseContractSatisfied === false)
      .length,
    explicitEvidenceReferences: selected.reduce(
      (sum, item) => sum + item.observedEvidenceReferencePaths.length,
      0,
    ),
    droppedRelevantRecommendations: selected.reduce(
      (sum, item) => sum + item.droppedRelevantRecommendationPaths.length,
      0,
    ),
    droppedRelevantLinkedSources: selected.reduce(
      (sum, item) => sum + (item.droppedRelevantLinkedPaths?.length ?? 0),
      0,
    ),
    droppedRelevantCoverageSources: selected.reduce(
      (sum, item) => sum + item.droppedRelevantCoveragePaths.length,
      0,
    ),
    droppedRelevantNoHitCandidates: selected.reduce(
      (sum, item) => sum + item.droppedRelevantNoHitCandidatePaths.length,
      0,
    ),
    unreferencedRelevantReturnedSources: selected.reduce(
      (sum, item) => sum + item.unreferencedRelevantReturnedPaths.length,
      0,
    ),
    totalDurationMs: selected.reduce((sum, item) => sum + item.durationMs, 0),
    duration: latencySummary(selected.map((item) => item.durationMs)),
    noHitDuration: latencySummary(noHitDurations),
    totalToolCalls: selected.reduce((sum, item) => sum + item.completedToolCalls, 0),
    totalCommands: selected.reduce((sum, item) => sum + item.completedCommands, 0),
    totalProviderTurns: selected.reduce((sum, item) => sum + (item.providerTurns ?? 1), 0),
    totalTokens: usage.reduce((sum, item) => sum + item.totalTokens, 0),
    meanTokens:
      usage.length === 0
        ? null
        : usage.reduce((sum, item) => sum + item.totalTokens, 0) / usage.length,
    usageObservedCases: usage.length,
  };
}

export function repeatedRetrievalBasisPointRatio(numerator, denominator) {
  if (numerator === null || denominator === null) return null;
  if (denominator === 0) return numerator === 0 ? 0 : null;
  return Math.round((numerator / denominator) * 10_000);
}
