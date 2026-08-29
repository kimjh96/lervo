import { delegatedRetrievalDigest } from "./delegated-retrieval-contract.mjs";
import { delegatedRetrievalProtocol } from "./delegated-retrieval-runner.mjs";
import { summarizeRepeatedRetrievalRuns } from "./repeated-retrieval-observation.mjs";
import { evaluateStagedEvidenceV7Acceptance } from "./staged-evidence-v7-acceptance.mjs";
import {
  buildStagedEvidenceV7Coverage,
  buildStagedEvidenceV7NoHitCatalog,
  parseStagedEvidenceV7Answer,
  parseStagedEvidenceV7Selection,
  stagedEvidenceV7AnswerProtocol,
  stagedEvidenceV7AnswerProtocolDigest,
  stagedEvidenceV7ProtocolDigest,
  stagedEvidenceV7SelectionProtocol,
  stagedEvidenceV7SelectionProtocolDigest,
  validateStagedEvidenceV7Recommendations,
  validateStagedEvidenceV7Suite,
} from "./staged-evidence-v7-contract.mjs";
import { runStagedEvidenceObservedArm } from "./staged-evidence-observed-arm.mjs";

export {
  evaluateStagedEvidenceV7Acceptance,
  stagedEvidenceV7AnswerProtocol,
  stagedEvidenceV7SelectionProtocol,
};

export async function runStagedEvidenceV7Benchmark(input) {
  const suite = validateStagedEvidenceV7Suite(input.suite);
  const corpus = await input.loadCorpus(input.repositoryRoot, suite);
  const corpusByPath = new Map(corpus.map((source) => [source.path, source]));
  const catalog = buildStagedEvidenceV7NoHitCatalog(
    corpus,
    suite.coverage.maximumNoHitCatalogBytes,
  );
  const runs = [];
  const armNames = ["model_direct", "staged_evidence_v7"];
  for (let repetition = 1; repetition <= suite.repetitionsPerArm; repetition += 1) {
    for (const [index, item] of suite.cases.entries()) {
      const recommendations = input.searchLexical(corpus, item.query, suite.lexicalLimit);
      validateStagedEvidenceV7Recommendations(item, recommendations);
      const coverage = buildStagedEvidenceV7Coverage({
        corpus,
        recommendations,
        query: item.query,
        coverage: suite.coverage,
        searchLexical: input.searchLexical,
      });
      const offset = (index + repetition - 1) % armNames.length;
      const order = [...armNames.slice(offset), ...armNames.slice(0, offset)];
      const arms = {};
      for (const arm of order) {
        input.onProgress?.({ caseId: item.caseId, arm, repetition });
        arms[arm] = await runStagedEvidenceObservedArm(
          {
            ...input,
            suite,
            item,
            arm,
            recommendations,
            coverage,
            catalog,
            corpusByPath,
            protocol: arm === "model_direct" ? delegatedRetrievalProtocol : undefined,
          },
          {
            armName: "staged_evidence_v7",
            selectionArmName: "staged_evidence_v7_selection",
            answerArmName: "staged_evidence_v7_answer",
            selectionProtocol: stagedEvidenceV7SelectionProtocol,
            answerProtocol: () => stagedEvidenceV7AnswerProtocol,
            parseSelection: parseStagedEvidenceV7Selection,
            parseAnswer: parseStagedEvidenceV7Answer,
            reconcile: () => true,
          },
        );
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
    reportKind: "staged_evidence_v7_observation",
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
    stages: { ...suite.stages, content: "excluded" },
    groundTruthReview: suite.groundTruthReview,
    policy: {
      policyId: "staged-evidence-selection-v7",
      protocolDigest: stagedEvidenceV7ProtocolDigest,
      selectionProtocolDigest: stagedEvidenceV7SelectionProtocolDigest,
      answerProtocolDigest: stagedEvidenceV7AnswerProtocolDigest,
      providerCompletenessDeclaration: "absent",
      explorationTrigger: "lexical_no_hits_only",
      evidenceProgression: ["selected", "loaded_and_injected", "output_referenced"],
      providerUseClaim: "absent",
      failureMeanings: [
        "provider_timeout",
        "provider_result_invalid",
        "provider_execution_failed",
        "selection_contract_failed",
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
      noHitCatalog: "repository_paths_headings_and_opaque_selection_tokens_only",
      sourceBodies: "excluded",
      absolutePaths: "excluded",
    },
    summary: {},
    runs,
  };
  report.summary = {
    modelDirect: summarizeRepeatedRetrievalRuns(runs, "model_direct"),
    stagedEvidenceV7: summarizeRepeatedRetrievalRuns(runs, "staged_evidence_v7"),
  };
  report.acceptance = suite.acceptance;
  report.decision = evaluateStagedEvidenceV7Acceptance(suite.acceptance, report.summary);
  return report;
}
