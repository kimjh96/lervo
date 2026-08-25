import {
  createSearchEvaluationComparison,
  createSearchEvaluationCoverage,
  executeSearchEvaluation,
  LexicalSearchIndex,
  type SearchEvaluationComparison,
  type SearchEvaluationEnginePort,
  type SearchEvaluationExecution,
} from "@lervo/search";

import { loadRegisteredDocumentCorpus } from "./corpus.js";
import { executeLocalSearchCandidate } from "./evaluation-candidate-executor.js";
import { loadSearchEvaluationBundles } from "./evaluation-bundle-files.js";
import { loadSearchEvaluationCases } from "./evaluation-case-files.js";
import { selectSearchEvaluationCases } from "./evaluation-case-selection.js";
import { LocalSearchEvaluationComparisonStore } from "./evaluation-comparison-store.js";
import { LocalSearchEvaluationStore } from "./evaluation-store.js";
import { SearchLocalError } from "./types.js";

export interface LocalSearchEvaluationComparisonOutput {
  comparison: SearchEvaluationComparison;
  baseline: SearchEvaluationExecution;
  candidate: SearchEvaluationExecution;
}

export async function runLocalSearchEvaluationComparison(input: {
  repositoryRoot: string;
  projectId: string;
  bundleId: string;
  candidateEngine: SearchEvaluationEnginePort;
  evaluatedAt: Date;
}): Promise<LocalSearchEvaluationComparisonOutput> {
  const availableCases = await loadSearchEvaluationCases(input.repositoryRoot);
  const bundles = await loadSearchEvaluationBundles({
    repositoryRoot: input.repositoryRoot,
    cases: availableCases,
  });
  const bundle = bundles.find((item) => item.bundleId === input.bundleId);
  if (bundle === undefined || bundle.projectId !== input.projectId) {
    throw new SearchLocalError(
      "evaluation_bundle_invalid",
      "The search evaluation bundle to compare was not found or belongs to a different project.",
    );
  }
  const coverage = createSearchEvaluationCoverage(bundle, availableCases);
  if (coverage.comparisonReadiness !== "ready") {
    throw new SearchLocalError(
      "evaluation_comparison_not_ready",
      "The candidate search will not run because the sample is insufficient.",
    );
  }
  const corpus = await loadRegisteredDocumentCorpus(input.repositoryRoot);
  const cases = selectSearchEvaluationCases(availableCases, coverage.activeCaseIds);
  const baselineIndex = new LexicalSearchIndex(corpus);
  const baseline = await executeSearchEvaluation({
    index: baselineIndex,
    cases,
    evaluatedAt: input.evaluatedAt,
  });
  const candidate = await executeLocalSearchCandidate({
    engine: input.candidateEngine,
    corpus,
    cases,
    evaluatedAt: input.evaluatedAt,
  });
  const evidence = { bundle, coverage, cases: availableCases, corpus, baseline, candidate };
  const comparison = createSearchEvaluationComparison({
    evidence,
    candidateAdapterBuildId: input.candidateEngine.adapterBuildId,
  });

  const [evaluationStore, comparisonStore] = await Promise.all([
    LocalSearchEvaluationStore.open(input.repositoryRoot),
    LocalSearchEvaluationComparisonStore.open(input.repositoryRoot),
  ]);
  await evaluationStore.record({ cases, ...baseline });
  await evaluationStore.record({ cases, ...candidate });
  await comparisonStore.record(comparison, evidence);
  return { comparison, baseline, candidate };
}
