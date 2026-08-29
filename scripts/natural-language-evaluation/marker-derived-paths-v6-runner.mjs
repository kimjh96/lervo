import { delegatedRetrievalDigest } from "./delegated-retrieval-contract.mjs";
import {
  delegatedRetrievalProtocol,
  runDelegatedRetrievalArm,
} from "./delegated-retrieval-runner.mjs";
import {
  buildMarkerDerivedPathsV6Coverage,
  buildMarkerDerivedPathsV6NoHitCatalog,
  markerDerivedPathsV6Protocol,
  markerDerivedPathsV6ProtocolDigest,
  parseMarkerDerivedPathsV6Result,
  validateMarkerDerivedPathsV6Recommendations,
  validateMarkerDerivedPathsV6Suite,
} from "./marker-derived-paths-v6-contract.mjs";
import {
  repeatedRetrievalBasisPointRatio,
  summarizeRepeatedRetrievalRuns,
} from "./repeated-retrieval-observation.mjs";

export { markerDerivedPathsV6Protocol };

function failureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("timed out")) return "provider_timeout";
  if (message.includes("adapter coordinates")) return "provider_result_invalid";
  return "provider_execution_failed";
}

function relevantPathObservations(input, result, candidatePaths) {
  const expectedPaths = new Set(input.item.expectedPaths);
  const returnedPaths = new Set(result.sourcePaths);
  const selectRelevant = (paths) => [...expectedPaths].filter((path) => new Set(paths).has(path));
  const relevantRecommendationPaths = selectRelevant(
    input.recommendations.map((source) => source.path),
  );
  const relevantCoveragePaths = selectRelevant(input.coverage.selectedPaths);
  const relevantNoHitCandidatePaths = selectRelevant(candidatePaths);
  const dropped = (paths) => paths.filter((path) => !returnedPaths.has(path));
  return {
    relevantRecommendationPaths,
    droppedRelevantRecommendationPaths: dropped(relevantRecommendationPaths),
    relevantCoveragePaths,
    droppedRelevantCoveragePaths: dropped(relevantCoveragePaths),
    relevantNoHitCandidatePaths,
    droppedRelevantNoHitCandidatePaths: dropped(relevantNoHitCandidatePaths),
  };
}

async function runArm(input) {
  const startedAt = Date.now();
  try {
    const noHits = input.recommendations.length === 0;
    const injectedEvidencePaths = [
      ...input.recommendations.map((source) => source.path),
      ...input.coverage.selectedPaths,
    ];
    const result = await runDelegatedRetrievalArm({
      ...input,
      ...(input.arm === "marker_derived_paths_v6"
        ? {
            parseResult: (value) =>
              parseMarkerDerivedPathsV6Result({
                ...value,
                noHits,
                injectedEvidencePaths,
                sourceTokenPaths: input.catalog.sourceTokenPaths,
                inspectionTokenPaths: input.catalog.inspectionTokenPaths,
                maximumCandidates: input.suite.coverage.maximumNoHitCandidates,
              }),
          }
        : {}),
    });
    if (input.arm !== "marker_derived_paths_v6") {
      return {
        ...result,
        passed: result.answerPassed,
        groundedAnswerPassed: result.answerPassed,
        coverageContractSatisfied: true,
        referenceContractSatisfied: true,
        sourceMarkerContractSatisfied: true,
        responseContractSatisfied: true,
        observedEvidenceReferencePaths: [],
        relevantRecommendationPaths: [],
        droppedRelevantRecommendationPaths: [],
        relevantCoveragePaths: [],
        droppedRelevantCoveragePaths: [],
        relevantNoHitCandidatePaths: [],
        droppedRelevantNoHitCandidatePaths: [],
        unreferencedRelevantReturnedPaths: [],
      };
    }
    const observation = result.protocolObservation;
    const coverageContractSatisfied =
      !noHits || (observation.candidatePaths.length > 0 && result.repositoryInspectionObserved);
    const relevant = relevantPathObservations(input, result, observation.candidatePaths);
    const groundedAnswerPassed =
      result.answerPassed &&
      coverageContractSatisfied &&
      observation.sourceMarkerContractSatisfied &&
      observation.responseContractSatisfied &&
      relevant.droppedRelevantRecommendationPaths.length === 0 &&
      relevant.droppedRelevantCoveragePaths.length === 0 &&
      relevant.droppedRelevantNoHitCandidatePaths.length === 0;
    return {
      ...result,
      ...relevant,
      passed: groundedAnswerPassed,
      groundedAnswerPassed,
      coverageContractSatisfied,
      referenceContractSatisfied: observation.sourceMarkerContractSatisfied,
      sourceMarkerContractSatisfied: observation.sourceMarkerContractSatisfied,
      responseContractSatisfied: observation.responseContractSatisfied,
      observedEvidenceReferencePaths: result.referencedDocumentPaths.filter((path) =>
        injectedEvidencePaths.includes(path),
      ),
      unreferencedRelevantReturnedPaths: [],
      responseContractViolations: observation.violations,
    };
  } catch (error) {
    const v6 = input.arm === "marker_derived_paths_v6";
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
      coverageContractSatisfied: !v6,
      referenceContractSatisfied: !v6,
      sourceMarkerContractSatisfied: !v6,
      responseContractSatisfied: !v6,
      observedEvidenceReferencePaths: [],
      relevantRecommendationPaths: [],
      droppedRelevantRecommendationPaths: [],
      relevantCoveragePaths: [],
      droppedRelevantCoveragePaths: [],
      relevantNoHitCandidatePaths: [],
      droppedRelevantNoHitCandidatePaths: [],
      unreferencedRelevantReturnedPaths: [],
      referencedDocumentPaths: [],
      injectedRecommendationPaths: [],
      injectedAdditionalDocumentPaths: [],
      responseContractViolations: [],
      failureCode: failureCode(error),
    };
  }
}

export function evaluateMarkerDerivedPathsV6Acceptance(acceptance, summary) {
  const direct = summary.modelDirect;
  const v6 = summary.markerDerivedPathsV6;
  const ratio = (field) => repeatedRetrievalBasisPointRatio(v6[field], direct[field]);
  const tokenRatioToModelDirectBasisPoints = ratio("totalTokens");
  const durationRatioToModelDirectBasisPoints = ratio("totalDurationMs");
  const noHitP95RatioToModelDirectBasisPoints = repeatedRetrievalBasisPointRatio(
    v6.noHitDuration.p95Ms,
    direct.noHitDuration.p95Ms,
  );
  const noHitStandardDeviationRatioToModelDirectBasisPoints = repeatedRetrievalBasisPointRatio(
    v6.noHitDuration.standardDeviationMs,
    direct.noHitDuration.standardDeviationMs,
  );
  const usageComplete =
    direct.usageObservedCases === direct.observations && v6.usageObservedCases === v6.observations;
  const criteria = {
    casesPassingEveryRepetition:
      v6.casesPassingEveryRepetition >= acceptance.minimumCasesPassingEveryRepetition,
    passCountNonInferiority:
      !acceptance.requirePassCountNonInferiorityToModelDirect || v6.passed >= direct.passed,
    recallNonInferiority:
      !acceptance.requireRecallNonInferiorityToModelDirect ||
      v6.expectedPathRecall >= direct.expectedPathRecall,
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
    coverageContracts: v6.failedCoverageContracts <= acceptance.maximumFailedCoverageContracts,
    sourceMarkerContracts:
      v6.failedSourceMarkerContracts <= acceptance.maximumFailedSourceMarkerContracts,
    responseContracts: v6.failedResponseContracts <= acceptance.maximumFailedResponseContracts,
    relevantRecommendations:
      v6.droppedRelevantRecommendations <= acceptance.maximumDroppedRelevantRecommendations,
    relevantCoverageSources:
      v6.droppedRelevantCoverageSources <= acceptance.maximumDroppedRelevantCoverageSources,
    relevantNoHitCandidates:
      v6.droppedRelevantNoHitCandidates <= acceptance.maximumDroppedRelevantNoHitCandidates,
    providerExecutions: v6.providerExecutionFailures <= acceptance.maximumFailedContracts,
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

export async function runMarkerDerivedPathsV6Benchmark(input) {
  const suite = validateMarkerDerivedPathsV6Suite(input.suite);
  const corpus = await input.loadCorpus(input.repositoryRoot, suite);
  const catalog = buildMarkerDerivedPathsV6NoHitCatalog(
    corpus,
    suite.coverage.maximumNoHitCatalogBytes,
  );
  const runs = [];
  const armNames = ["model_direct", "marker_derived_paths_v6"];
  for (let repetition = 1; repetition <= suite.repetitionsPerArm; repetition += 1) {
    for (const [index, item] of suite.cases.entries()) {
      const recommendations = input.searchLexical(corpus, item.query, suite.lexicalLimit);
      validateMarkerDerivedPathsV6Recommendations(item, recommendations);
      const coverage = buildMarkerDerivedPathsV6Coverage({
        corpus,
        recommendations,
        query: item.query,
        coverage: suite.coverage,
        searchLexical: input.searchLexical,
      });
      const noHits = recommendations.length === 0;
      const offset = (index + repetition - 1) % armNames.length;
      const order = [...armNames.slice(offset), ...armNames.slice(0, offset)];
      const arms = {};
      for (const arm of order) {
        input.onProgress?.({ caseId: item.caseId, arm, repetition });
        arms[arm] = await runArm({
          ...input,
          suite,
          item,
          arm,
          recommendations,
          coverage,
          catalog,
          protocol:
            arm === "marker_derived_paths_v6"
              ? markerDerivedPathsV6Protocol
              : delegatedRetrievalProtocol,
          ...(arm === "marker_derived_paths_v6"
            ? {
                additionalDocuments: [...coverage.documents, ...(noHits ? [catalog.document] : [])],
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
        deterministicCoveragePaths: coverage.selectedPaths,
        termSelections: coverage.termSelections,
        deterministicCoverageByteCount: coverage.byteCount,
        armOrder: order,
        arms,
      });
    }
  }
  const report = {
    schemaVersion: 1,
    reportKind: "marker_derived_paths_v6_observation",
    suiteId: suite.suiteId,
    suiteDigest: delegatedRetrievalDigest(suite),
    provider: input.provider,
    model: input.model,
    repositorySnapshot: input.repositorySnapshot,
    corpusDigest: input.corpusDigest(corpus),
    observedAt: new Date().toISOString(),
    repetitionsPerArm: suite.repetitionsPerArm,
    coverage: {
      ...suite.coverage,
      noHitCatalogSourceCount: catalog.entries.length,
      noHitCatalogByteCount: catalog.byteCount,
      noHitCatalogContentHash: catalog.contentHash,
      content: "excluded",
    },
    marker: { ...suite.marker, content: "excluded" },
    groundTruthReview: suite.groundTruthReview,
    policy: {
      policyId: "marker-derived-source-paths-v6",
      protocolDigest: markerDerivedPathsV6ProtocolDigest,
      providerCompletenessDeclaration: "absent",
      explorationTrigger: "lexical_no_hits_only",
      sourcePathDerivation: "recognized_output_markers_only",
      failureMeanings: [
        "provider_timeout",
        "provider_result_invalid",
        "provider_execution_failed",
        "coverage_contract_failed",
        "source_marker_contract_failed",
        "response_contract_failed",
        "relevant_recommendation_dropped",
        "relevant_coverage_source_dropped",
        "relevant_no_hit_candidate_dropped",
      ],
    },
    privacy: {
      queries: "checked_in_public",
      answers: "operator_output_only",
      markers: "operator_output_only",
      noHitCatalog: "repository_paths_headings_and_opaque_tokens_only",
      sourceBodies: "excluded",
      absolutePaths: "excluded",
    },
    summary: {},
    runs,
  };
  report.summary = {
    modelDirect: summarizeRepeatedRetrievalRuns(runs, "model_direct"),
    markerDerivedPathsV6: summarizeRepeatedRetrievalRuns(runs, "marker_derived_paths_v6"),
  };
  report.acceptance = suite.acceptance;
  report.decision = evaluateMarkerDerivedPathsV6Acceptance(suite.acceptance, report.summary);
  return report;
}
