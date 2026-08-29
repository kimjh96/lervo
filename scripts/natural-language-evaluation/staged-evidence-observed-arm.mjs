import { runDelegatedRetrievalArm } from "./delegated-retrieval-runner.mjs";

function failureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("timed out")) return "provider_timeout";
  if (message.includes("adapter coordinates") || message.includes("selected source"))
    return "provider_result_invalid";
  return "provider_execution_failed";
}

function combineUsage(selection, answer) {
  if (selection === null || answer === null) return null;
  const sum = (field) => (selection[field] ?? 0) + (answer[field] ?? 0);
  return {
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    outputTokens: sum("outputTokens"),
    reasoningOutputTokens: sum("reasoningOutputTokens"),
    totalTokens: sum("totalTokens"),
    contextWindow: Math.max(selection.contextWindow ?? 0, answer.contextWindow ?? 0),
    stageCount: 2,
  };
}

function relevantPathObservations(input, sourcePaths, candidatePaths) {
  const expectedPaths = new Set(input.item.expectedPaths);
  const returnedPaths = new Set(sourcePaths);
  const selectRelevant = (paths) => [...expectedPaths].filter((path) => new Set(paths).has(path));
  const relevantRecommendationPaths = selectRelevant(
    (input.lexicalRecommendations ?? input.recommendations).map((source) => source.path),
  );
  const relevantLinkedPaths = selectRelevant(
    (input.linkedSources ?? []).map((source) => source.path),
  );
  const relevantCoveragePaths = selectRelevant(input.coverage.selectedPaths);
  const relevantNoHitCandidatePaths = selectRelevant(candidatePaths);
  const dropped = (paths) => paths.filter((path) => !returnedPaths.has(path));
  return {
    relevantRecommendationPaths,
    droppedRelevantRecommendationPaths: dropped(relevantRecommendationPaths),
    relevantLinkedPaths,
    droppedRelevantLinkedPaths: dropped(relevantLinkedPaths),
    relevantCoveragePaths,
    droppedRelevantCoveragePaths: dropped(relevantCoveragePaths),
    relevantNoHitCandidatePaths,
    droppedRelevantNoHitCandidatePaths: dropped(relevantNoHitCandidatePaths),
  };
}

function directObservation(result) {
  return {
    ...result,
    passed: result.answerPassed,
    groundedAnswerPassed: result.answerPassed,
    providerTurns: 1,
    selectionContractSatisfied: true,
    coverageContractSatisfied: true,
    reconciliationContractSatisfied: true,
    referenceContractSatisfied: true,
    sourceMarkerContractSatisfied: true,
    responseContractSatisfied: true,
    observedEvidenceReferencePaths: [],
    selectedSourcePaths: [],
    loadedSourcePaths: [],
    relevantRecommendationPaths: [],
    droppedRelevantRecommendationPaths: [],
    relevantLinkedPaths: [],
    droppedRelevantLinkedPaths: [],
    relevantCoveragePaths: [],
    droppedRelevantCoveragePaths: [],
    relevantNoHitCandidatePaths: [],
    droppedRelevantNoHitCandidatePaths: [],
    unreferencedRelevantReturnedPaths: [],
  };
}

function absentAnswerObservation(input, selection, relevant, policy) {
  return {
    arm: policy.armName,
    passedContract: true,
    passed: false,
    answerPassed: false,
    groundedAnswerPassed: false,
    matchedPaths: [],
    missingPaths: [...input.item.expectedPaths],
    unexpectedPaths: [],
    expectedPathRecall: 0,
    returnedPathPrecision: 0,
    sourcePaths: [],
    abstained: false,
    durationMs: selection.durationMs,
    completedToolCalls: selection.completedToolCalls,
    completedCommands: selection.completedCommands,
    providerErrors: selection.providerErrors,
    usage: null,
    providerTurns: 1,
    repositoryInspectionObserved: selection.repositoryInspectionObserved,
    selectionContractSatisfied: false,
    coverageContractSatisfied: false,
    reconciliationContractSatisfied: false,
    referenceContractSatisfied: true,
    sourceMarkerContractSatisfied: true,
    responseContractSatisfied: false,
    observedEvidenceReferencePaths: [],
    referencedDocumentPaths: [],
    injectedRecommendationPaths: [],
    injectedAdditionalDocumentPaths: [],
    selectedSourcePaths: selection.protocolObservation.selectedPaths,
    loadedSourcePaths: [],
    unreferencedRelevantReturnedPaths: [],
    responseContractViolations: ["answer_stage_not_run"],
    selectionContractViolations: selection.protocolObservation.violations,
    ...relevant,
  };
}

async function runStagedArm(input, policy) {
  const noHits = input.recommendations.length === 0;
  const injectedEvidencePaths = [
    ...input.recommendations.map((source) => source.path),
    ...input.coverage.selectedPaths,
  ];
  const selection = await runDelegatedRetrievalArm({
    ...input,
    arm: policy.selectionArmName,
    protocol: policy.selectionProtocol,
    additionalDocuments: noHits ? [input.catalog.document] : input.coverage.documents,
    parseResult: (value) =>
      policy.parseSelection({
        ...value,
        noHits,
        injectedEvidencePaths,
        selectionTokenPaths: input.catalog.selectionTokenPaths,
        maximumNoHitCandidates: input.suite.coverage.maximumNoHitCandidates,
        maximumSelectedSources: input.suite.stages.maximumSelectedSources,
      }),
  });
  const selectedPaths = selection.protocolObservation.selectedPaths;
  const relevant = relevantPathObservations(
    input,
    [],
    selection.protocolObservation.candidatePaths,
  );
  if (!selection.protocolObservation.selectionContractSatisfied) {
    return absentAnswerObservation(input, selection, relevant, policy);
  }
  const selectedSources = selectedPaths.map((sourcePath) => input.corpusByPath.get(sourcePath));
  if (selectedSources.some((source) => source === undefined)) {
    throw new TypeError("A selected source is unavailable from the bound corpus.");
  }
  const answer = await runDelegatedRetrievalArm({
    ...input,
    arm: policy.answerArmName,
    recommendations: selectedSources,
    additionalDocuments: [],
    protocol: policy.answerProtocol(noHits),
    parseResult: (value) =>
      policy.parseAnswer({
        ...value,
        injectedEvidencePaths: selectedPaths,
      }),
  });
  const observation = answer.protocolObservation;
  const noHitReferenceObserved =
    !noHits || answer.sourcePaths.some((sourcePath) => selectedPaths.includes(sourcePath));
  const coverageContractSatisfied =
    selection.protocolObservation.selectionContractSatisfied &&
    selectedSources.length === selectedPaths.length &&
    noHitReferenceObserved;
  const reconciliationContractSatisfied = policy.reconcile(
    noHits,
    selectedPaths,
    answer.sourcePaths,
  );
  const finalRelevant = relevantPathObservations(
    input,
    answer.sourcePaths,
    selection.protocolObservation.candidatePaths,
  );
  const groundedAnswerPassed =
    answer.answerPassed &&
    coverageContractSatisfied &&
    reconciliationContractSatisfied &&
    observation.sourceMarkerContractSatisfied &&
    observation.responseContractSatisfied &&
    finalRelevant.droppedRelevantRecommendationPaths.length === 0 &&
    finalRelevant.droppedRelevantLinkedPaths.length === 0 &&
    finalRelevant.droppedRelevantCoveragePaths.length === 0 &&
    finalRelevant.droppedRelevantNoHitCandidatePaths.length === 0;
  return {
    ...answer,
    ...finalRelevant,
    arm: policy.armName,
    passed: groundedAnswerPassed,
    groundedAnswerPassed,
    durationMs: selection.durationMs + answer.durationMs,
    completedToolCalls: selection.completedToolCalls + answer.completedToolCalls,
    completedCommands: selection.completedCommands + answer.completedCommands,
    providerErrors: selection.providerErrors + answer.providerErrors,
    usage: combineUsage(selection.usage, answer.usage),
    providerTurns: 2,
    repositoryInspectionObserved:
      selection.repositoryInspectionObserved || answer.repositoryInspectionObserved,
    selectionContractSatisfied: selection.protocolObservation.selectionContractSatisfied,
    coverageContractSatisfied,
    reconciliationContractSatisfied,
    referenceContractSatisfied: observation.sourceMarkerContractSatisfied,
    sourceMarkerContractSatisfied: observation.sourceMarkerContractSatisfied,
    responseContractSatisfied: observation.responseContractSatisfied,
    observedEvidenceReferencePaths: answer.referencedDocumentPaths.filter((sourcePath) =>
      selectedPaths.includes(sourcePath),
    ),
    selectedSourcePaths: selectedPaths,
    loadedSourcePaths: selectedSources.map((source) => source.path),
    unreferencedRelevantReturnedPaths: [],
    responseContractViolations: observation.violations,
    selectionContractViolations: selection.protocolObservation.violations,
  };
}

export async function runStagedEvidenceObservedArm(input, policy) {
  const startedAt = Date.now();
  try {
    if (input.arm === "model_direct") {
      return directObservation(await runDelegatedRetrievalArm(input));
    }
    return await runStagedArm(input, policy);
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
      providerTurns: 0,
      repositoryInspectionObserved: false,
      selectionContractSatisfied: input.arm === "model_direct",
      coverageContractSatisfied: input.arm === "model_direct",
      reconciliationContractSatisfied: input.arm === "model_direct",
      referenceContractSatisfied: input.arm === "model_direct",
      sourceMarkerContractSatisfied: input.arm === "model_direct",
      responseContractSatisfied: input.arm === "model_direct",
      observedEvidenceReferencePaths: [],
      selectedSourcePaths: [],
      loadedSourcePaths: [],
      relevantRecommendationPaths: [],
      droppedRelevantRecommendationPaths: [],
      relevantLinkedPaths: [],
      droppedRelevantLinkedPaths: [],
      relevantCoveragePaths: [],
      droppedRelevantCoveragePaths: [],
      relevantNoHitCandidatePaths: [],
      droppedRelevantNoHitCandidatePaths: [],
      unreferencedRelevantReturnedPaths: [],
      referencedDocumentPaths: [],
      injectedRecommendationPaths: [],
      injectedAdditionalDocumentPaths: [],
      responseContractViolations: [],
      selectionContractViolations: [],
      failureCode: failureCode(error),
    };
  }
}
