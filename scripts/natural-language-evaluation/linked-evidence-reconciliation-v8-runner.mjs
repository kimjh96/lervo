import { delegatedRetrievalDigest } from "./delegated-retrieval-contract.mjs";
import { delegatedRetrievalProtocol } from "./delegated-retrieval-runner.mjs";
import { evaluateLinkedEvidenceReconciliationV8Acceptance } from "./linked-evidence-reconciliation-v8-acceptance.mjs";
import {
  buildLinkedEvidenceReconciliationV8Coverage,
  buildLinkedEvidenceReconciliationV8Expansion,
  buildLinkedEvidenceReconciliationV8NoHitCatalog,
  exactPathSetReconciled,
  linkedEvidenceReconciliationV8HitAnswerProtocol,
  linkedEvidenceReconciliationV8HitAnswerProtocolDigest,
  linkedEvidenceReconciliationV8NoHitAnswerProtocol,
  linkedEvidenceReconciliationV8ProtocolDigest,
  linkedEvidenceReconciliationV8SelectionProtocol,
  linkedEvidenceReconciliationV8SelectionProtocolDigest,
  parseLinkedEvidenceReconciliationV8Answer,
  parseLinkedEvidenceReconciliationV8Selection,
  validateLinkedEvidenceReconciliationV8Recommendations,
  validateLinkedEvidenceReconciliationV8Suite,
} from "./linked-evidence-reconciliation-v8-contract.mjs";
import { summarizeRepeatedRetrievalRuns } from "./repeated-retrieval-observation.mjs";
import { runStagedEvidenceObservedArm } from "./staged-evidence-observed-arm.mjs";
import { stagedEvidenceV7AnswerProtocolDigest } from "./staged-evidence-v7-contract.mjs";

export {
  evaluateLinkedEvidenceReconciliationV8Acceptance,
  linkedEvidenceReconciliationV8HitAnswerProtocol,
  linkedEvidenceReconciliationV8SelectionProtocol,
};

const stagedPolicy = {
  armName: "linked_evidence_reconciliation_v8",
  selectionArmName: "linked_evidence_reconciliation_v8_selection",
  answerArmName: "linked_evidence_reconciliation_v8_answer",
  selectionProtocol: linkedEvidenceReconciliationV8SelectionProtocol,
  answerProtocol: (noHits) =>
    noHits
      ? linkedEvidenceReconciliationV8NoHitAnswerProtocol
      : linkedEvidenceReconciliationV8HitAnswerProtocol,
  parseSelection: parseLinkedEvidenceReconciliationV8Selection,
  parseAnswer: parseLinkedEvidenceReconciliationV8Answer,
  reconcile: (noHits, selectedPaths, referencedPaths) =>
    noHits || exactPathSetReconciled(selectedPaths, referencedPaths),
};

function linkedExpansion(input) {
  return buildLinkedEvidenceReconciliationV8Expansion({
    corpus: input.corpus,
    recommendations: input.recommendations,
    existingPaths: [
      ...input.recommendations.map((source) => source.path),
      ...input.coverage.selectedPaths,
    ],
    contract: input.suite.linkedEvidence,
  });
}

export async function runLinkedEvidenceReconciliationV8Benchmark(input) {
  const suite = validateLinkedEvidenceReconciliationV8Suite(input.suite);
  const corpus = await input.loadCorpus(input.repositoryRoot, suite);
  const corpusByPath = new Map(corpus.map((source) => [source.path, source]));
  const catalog = buildLinkedEvidenceReconciliationV8NoHitCatalog(
    corpus,
    suite.coverage.maximumNoHitCatalogBytes,
  );
  const runs = [];
  const armNames = ["model_direct", "linked_evidence_reconciliation_v8"];
  for (let repetition = 1; repetition <= suite.repetitionsPerArm; repetition += 1) {
    for (const [index, item] of suite.cases.entries()) {
      const recommendations = input.searchLexical(corpus, item.query, suite.lexicalLimit);
      validateLinkedEvidenceReconciliationV8Recommendations(item, recommendations);
      const coverage = buildLinkedEvidenceReconciliationV8Coverage({
        corpus,
        recommendations,
        query: item.query,
        coverage: suite.coverage,
        searchLexical: input.searchLexical,
      });
      const linked = linkedExpansion({ corpus, recommendations, coverage, suite });
      const stagedRecommendations = [...recommendations, ...linked.sources];
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
            recommendations: stagedRecommendations,
            lexicalRecommendations: recommendations,
            linkedSources: linked.sources,
            coverage,
            catalog,
            corpusByPath,
            protocol: arm === "model_direct" ? delegatedRetrievalProtocol : undefined,
          },
          stagedPolicy,
        );
      }
      runs.push({
        caseId: item.caseId,
        taskType: item.taskType,
        requestStyle: item.requestStyle,
        repetition,
        expectedPaths: item.expectedPaths,
        lexicalRecommendationPaths: recommendations.map((source) => source.path),
        linkedEvidencePaths: linked.selectedPaths,
        linkedEvidenceLinks: linked.links,
        linkedEvidenceCandidateCount: linked.candidateCount,
        linkedEvidenceTruncated: linked.truncated,
        linkedEvidenceByteCount: linked.byteCount,
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
    reportKind: "linked_evidence_reconciliation_v8_observation",
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
    linkedEvidence: { ...suite.linkedEvidence, content: "excluded" },
    stages: { ...suite.stages, content: "excluded" },
    groundTruthReview: suite.groundTruthReview,
    policy: {
      policyId: "linked-evidence-reconciliation-v8",
      protocolDigest: linkedEvidenceReconciliationV8ProtocolDigest,
      selectionProtocolDigest: linkedEvidenceReconciliationV8SelectionProtocolDigest,
      hitAnswerProtocolDigest: linkedEvidenceReconciliationV8HitAnswerProtocolDigest,
      noHitAnswerProtocolDigest: stagedEvidenceV7AnswerProtocolDigest,
      providerCompletenessDeclaration: "absent",
      explorationTrigger: "lexical_no_hits_only",
      linkedExpansionTrigger: "lexical_hits_only",
      evidenceProgression: ["selected", "loaded_and_injected", "output_referenced"],
      providerUseClaim: "absent",
      failureMeanings: [
        "provider_timeout",
        "provider_result_invalid",
        "provider_execution_failed",
        "linked_evidence_bound_failed",
        "selection_contract_failed",
        "coverage_contract_failed",
        "reconciliation_contract_failed",
        "source_marker_contract_failed",
        "response_contract_failed",
        "relevant_recommendation_dropped",
        "relevant_linked_source_dropped",
        "relevant_coverage_source_dropped",
        "relevant_no_hit_candidate_dropped",
      ],
    },
    privacy: {
      queries: "checked_in_public",
      answers: "operator_output_only",
      markers: "operator_output_only",
      links: "checked_in_repository_relative_paths_only",
      noHitCatalog: "repository_paths_headings_and_opaque_selection_tokens_only",
      sourceBodies: "excluded",
      absolutePaths: "excluded",
    },
    summary: {},
    runs,
  };
  report.summary = {
    modelDirect: summarizeRepeatedRetrievalRuns(runs, "model_direct"),
    linkedEvidenceReconciliationV8: summarizeRepeatedRetrievalRuns(
      runs,
      "linked_evidence_reconciliation_v8",
    ),
  };
  report.acceptance = suite.acceptance;
  report.decision = evaluateLinkedEvidenceReconciliationV8Acceptance(
    suite.acceptance,
    report.summary,
  );
  return report;
}
