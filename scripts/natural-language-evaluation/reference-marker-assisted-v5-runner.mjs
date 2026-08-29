import { delegatedRetrievalDigest } from "./delegated-retrieval-contract.mjs";
import {
  delegatedRetrievalProtocol,
  runDelegatedRetrievalArm,
} from "./delegated-retrieval-runner.mjs";
import {
  buildReferenceMarkerAssistedV5Coverage,
  buildReferenceMarkerAssistedV5NoHitCatalog,
  evaluateReferenceMarkerAssistedV5Contract,
  parseReferenceMarkerAssistedV5NoHitInspection,
  referenceMarkerAssistedV5Protocol,
  referenceMarkerAssistedV5ProtocolDigest,
  validateReferenceMarkerAssistedV5Recommendations,
  validateReferenceMarkerAssistedV5Suite,
} from "./reference-marker-assisted-v5-contract.mjs";
import {
  repeatedRetrievalBasisPointRatio,
  summarizeRepeatedRetrievalRuns,
} from "./repeated-retrieval-observation.mjs";

export { referenceMarkerAssistedV5Protocol };

const protocolPath = ".lervo/protocols/delegated-retrieval-benchmark-v1.md";

function failureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("timed out")) return "provider_timeout";
  if (
    message.includes("JSON object") ||
    message.includes("answer contract") ||
    message.includes("no-hit inspection") ||
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
    if (input.arm !== "reference_marker_assisted_v5") {
      return {
        ...result,
        passed: result.answerPassed,
        groundedAnswerPassed: result.answerPassed,
        coverageContractSatisfied: true,
        referenceContractSatisfied: true,
        observedEvidenceReferencePaths: [],
        missingReferencePaths: [],
        relevantRecommendationPaths: [],
        droppedRelevantRecommendationPaths: [],
        relevantCoveragePaths: [],
        droppedRelevantCoveragePaths: [],
        relevantNoHitCandidatePaths: [],
        droppedRelevantNoHitCandidatePaths: [],
        unreferencedRelevantReturnedPaths: [],
      };
    }
    const noHits = input.recommendations.length === 0;
    const inspection = result.protocolObservation;
    const coverageContractSatisfied =
      !noHits || (inspection.candidatePaths.length > 0 && result.repositoryInspectionObserved);
    const injectedEvidencePaths = [
      ...input.recommendations.map((source) => source.path),
      ...input.coverage.selectedPaths,
    ];
    const reference = evaluateReferenceMarkerAssistedV5Contract({
      injectedEvidencePaths,
      sourcePaths: result.sourcePaths,
      referencedDocumentPaths: result.referencedDocumentPaths,
      forbiddenReferencePaths: [protocolPath, input.catalogDocumentPath],
    });
    const expectedPaths = new Set(input.item.expectedPaths);
    const recommendationPaths = new Set(input.recommendations.map((source) => source.path));
    const relevantRecommendationPaths = [...expectedPaths].filter((path) =>
      recommendationPaths.has(path),
    );
    const coveragePaths = new Set(input.coverage.selectedPaths);
    const relevantCoveragePaths = [...expectedPaths].filter((path) => coveragePaths.has(path));
    const noHitCandidatePaths = new Set(inspection.candidatePaths);
    const relevantNoHitCandidatePaths = [...expectedPaths].filter((path) =>
      noHitCandidatePaths.has(path),
    );
    const returnedPaths = new Set(result.sourcePaths);
    const droppedRelevantRecommendationPaths = relevantRecommendationPaths.filter(
      (path) => !returnedPaths.has(path),
    );
    const droppedRelevantCoveragePaths = relevantCoveragePaths.filter(
      (path) => !returnedPaths.has(path),
    );
    const droppedRelevantNoHitCandidatePaths = relevantNoHitCandidatePaths.filter(
      (path) => !returnedPaths.has(path),
    );
    const missingReferencePaths = new Set(reference.missingReferencePaths);
    const unreferencedRelevantReturnedPaths = [
      ...new Set([...relevantRecommendationPaths, ...relevantCoveragePaths]),
    ].filter((path) => returnedPaths.has(path) && missingReferencePaths.has(path));
    const groundedAnswerPassed =
      result.answerPassed &&
      coverageContractSatisfied &&
      reference.satisfied &&
      droppedRelevantRecommendationPaths.length === 0 &&
      droppedRelevantCoveragePaths.length === 0 &&
      droppedRelevantNoHitCandidatePaths.length === 0 &&
      unreferencedRelevantReturnedPaths.length === 0;
    return {
      ...result,
      passed: groundedAnswerPassed,
      groundedAnswerPassed,
      coverageContractSatisfied,
      referenceContractSatisfied: reference.satisfied,
      observedEvidenceReferencePaths: reference.observedEvidenceReferencePaths,
      missingReferencePaths: reference.missingReferencePaths,
      unreturnedReferencePaths: reference.unreturnedReferencePaths,
      forbiddenReferencePaths: reference.forbiddenReferencePaths,
      unknownReferencePaths: reference.unknownReferencePaths,
      relevantRecommendationPaths,
      droppedRelevantRecommendationPaths,
      relevantCoveragePaths,
      droppedRelevantCoveragePaths,
      relevantNoHitCandidatePaths,
      droppedRelevantNoHitCandidatePaths,
      unreferencedRelevantReturnedPaths,
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
      coverageContractSatisfied: input.arm !== "reference_marker_assisted_v5",
      referenceContractSatisfied: input.arm !== "reference_marker_assisted_v5",
      observedEvidenceReferencePaths: [],
      missingReferencePaths: [],
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
      failureCode: failureCode(error),
    };
  }
}

export function evaluateReferenceMarkerAssistedV5Acceptance(acceptance, summary) {
  const direct = summary.modelDirect;
  const v5 = summary.referenceMarkerAssistedV5;
  const tokenRatioToModelDirectBasisPoints = repeatedRetrievalBasisPointRatio(
    v5.totalTokens,
    direct.totalTokens,
  );
  const durationRatioToModelDirectBasisPoints = repeatedRetrievalBasisPointRatio(
    v5.totalDurationMs,
    direct.totalDurationMs,
  );
  const noHitP95RatioToModelDirectBasisPoints = repeatedRetrievalBasisPointRatio(
    v5.noHitDuration.p95Ms,
    direct.noHitDuration.p95Ms,
  );
  const noHitStandardDeviationRatioToModelDirectBasisPoints = repeatedRetrievalBasisPointRatio(
    v5.noHitDuration.standardDeviationMs,
    direct.noHitDuration.standardDeviationMs,
  );
  const usageComplete =
    direct.usageObservedCases === direct.observations && v5.usageObservedCases === v5.observations;
  const criteria = {
    casesPassingEveryRepetition:
      v5.casesPassingEveryRepetition >= acceptance.minimumCasesPassingEveryRepetition,
    passCountNonInferiority:
      !acceptance.requirePassCountNonInferiorityToModelDirect || v5.passed >= direct.passed,
    recallNonInferiority:
      !acceptance.requireRecallNonInferiorityToModelDirect ||
      v5.expectedPathRecall >= direct.expectedPathRecall,
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
    coverageContracts: v5.failedCoverageContracts <= acceptance.maximumFailedCoverageContracts,
    referenceContracts: v5.failedReferenceContracts <= acceptance.maximumFailedReferenceContracts,
    relevantRecommendations:
      v5.droppedRelevantRecommendations <= acceptance.maximumDroppedRelevantRecommendations,
    relevantCoverageSources:
      v5.droppedRelevantCoverageSources <= acceptance.maximumDroppedRelevantCoverageSources,
    relevantNoHitCandidates:
      v5.droppedRelevantNoHitCandidates <= acceptance.maximumDroppedRelevantNoHitCandidates,
    relevantReturnedReferences:
      v5.unreferencedRelevantReturnedSources <=
      acceptance.maximumUnreferencedRelevantReturnedSources,
    providerContracts: v5.failedContracts <= acceptance.maximumFailedContracts,
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

export async function runReferenceMarkerAssistedV5Benchmark(input) {
  const suite = validateReferenceMarkerAssistedV5Suite(input.suite);
  const corpus = await input.loadCorpus(input.repositoryRoot, suite);
  const catalog = buildReferenceMarkerAssistedV5NoHitCatalog(
    corpus,
    suite.coverage.maximumNoHitCatalogBytes,
  );
  const runs = [];
  const armNames = ["model_direct", "reference_marker_assisted_v5"];
  for (let repetition = 1; repetition <= suite.repetitionsPerArm; repetition += 1) {
    for (const [index, item] of suite.cases.entries()) {
      const recommendations = input.searchLexical(corpus, item.query, suite.lexicalLimit);
      validateReferenceMarkerAssistedV5Recommendations(item, recommendations);
      const coverage = buildReferenceMarkerAssistedV5Coverage({
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
          item,
          arm,
          recommendations,
          coverage,
          catalogDocumentPath: catalog.document.path,
          protocol:
            arm === "reference_marker_assisted_v5"
              ? referenceMarkerAssistedV5Protocol
              : delegatedRetrievalProtocol,
          ...(arm === "reference_marker_assisted_v5"
            ? {
                additionalDocuments: [...coverage.documents, ...(noHits ? [catalog.document] : [])],
                observeAnswer: (answer) =>
                  parseReferenceMarkerAssistedV5NoHitInspection(answer, {
                    noHits,
                    catalogPaths: catalog.pathSet,
                    maximumCandidates: suite.coverage.maximumNoHitCandidates,
                  }),
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
    reportKind: "reference_marker_assisted_v5_observation",
    suiteId: suite.suiteId,
    suiteDigest: delegatedRetrievalDigest(suite),
    provider: input.provider,
    model: input.model,
    repositorySnapshot: input.repositorySnapshot,
    corpusDigest: input.corpusDigest(corpus),
    observedAt: new Date().toISOString(),
    repetitionsPerArm: suite.repetitionsPerArm,
    coverage: {
      corePaths: suite.coverage.corePaths,
      maximumAsciiTerms: suite.coverage.maximumAsciiTerms,
      termLexicalLimit: suite.coverage.termLexicalLimit,
      maximumInjectedCoverageBytes: suite.coverage.maximumInjectedCoverageBytes,
      noHitCatalogFormat: suite.coverage.noHitCatalogFormat,
      noHitCatalogSourceCount: catalog.entries.length,
      noHitCatalogByteCount: catalog.byteCount,
      noHitCatalogContentHash: catalog.contentHash,
      content: "excluded",
    },
    reference: {
      ...suite.reference,
      evidenceMeaning: "observable_output_reference_only",
      content: "excluded",
    },
    policy: {
      policyId: "observable-evidence-reference-v5",
      protocolDigest: referenceMarkerAssistedV5ProtocolDigest,
      providerCompletenessDeclaration: "absent",
      explorationTrigger: "lexical_no_hits_only",
      relevantSourceRule: "expected_path_intersection",
      failureMeanings: [
        "provider_timeout",
        "provider_result_invalid",
        "provider_execution_failed",
        "coverage_contract_failed",
        "reference_contract_failed",
        "relevant_recommendation_dropped",
        "relevant_coverage_source_dropped",
        "relevant_no_hit_candidate_dropped",
        "relevant_returned_source_unreferenced",
      ],
    },
    privacy: {
      queries: "checked_in_public",
      answers: "operator_output_only",
      evidenceMarkers: "operator_output_only",
      noHitCatalog: "repository_paths_and_first_headings_only",
      sourceBodies: "excluded",
      absolutePaths: "excluded",
    },
    summary: {},
    runs,
  };
  report.summary = {
    modelDirect: summarizeRepeatedRetrievalRuns(runs, "model_direct"),
    referenceMarkerAssistedV5: summarizeRepeatedRetrievalRuns(runs, "reference_marker_assisted_v5"),
  };
  report.acceptance = suite.acceptance;
  report.decision = evaluateReferenceMarkerAssistedV5Acceptance(suite.acceptance, report.summary);
  return report;
}
