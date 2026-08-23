import { assertSearchEvaluationBundle, SEARCH_EVALUATION_BUNDLE_ID_PATTERN } from "./evaluation-bundle.js";
import type { SearchEvaluationBundle, SearchEvaluationCoverage } from "./evaluation-bundle-types.js";
import {
  type SearchEvaluationComparison,
  type SearchEvaluationCaseComparison,
  type SearchEvaluationComparisonRunReference,
  type CurrentSearchEvaluationComparison,
  type LegacySearchEvaluationComparison,
} from "./evaluation-comparison-types.js";
import { assertSearchEvaluationCoverage } from "./evaluation-coverage.js";
import {
  assertSearchAdapterBuildId,
  assertSearchEngineIdentity,
  SEARCH_INDEX_ID_PATTERN,
  sameSearchEngine,
} from "./evaluation-engine.js";
import {
  SEARCH_EVALUATION_CASE_PATTERN,
  SEARCH_EVALUATION_RESULT_PATTERN,
  SEARCH_EVALUATION_RUN_PATTERN,
  compareText,
} from "./evaluation-common.js";
import { assertSearchEvaluationRun } from "./evaluation-run.js";
import type { SearchEvaluationCase, SearchEvaluationResult, SearchEvaluationRun } from "./evaluation-types.js";
import { LexicalSearchIndex } from "./engine.js";
import { contentId } from "./integrity.js";
import { SEARCH_ENGINE, SearchError, type SearchSourceInput } from "./types.js";
import { assertTimestamp, SHA256_PATTERN, SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_EVALUATION_COMPARISON_PATTERN = /^secmp_[a-f0-9]{24}$/;

export interface SearchEvaluationComparisonEvidence {
  bundle: SearchEvaluationBundle;
  coverage: SearchEvaluationCoverage;
  cases: readonly SearchEvaluationCase[];
  corpus: readonly SearchSourceInput[];
  baseline: { run: SearchEvaluationRun; results: readonly SearchEvaluationResult[] };
  candidate: { run: SearchEvaluationRun; results: readonly SearchEvaluationResult[] };
}

function runReference(run: SearchEvaluationRun): SearchEvaluationComparisonRunReference {
  return { engine: { ...run.engine }, indexId: run.indexId, runId: run.runId };
}

function outcome(
  baseline: SearchEvaluationResult,
  candidate: SearchEvaluationResult,
): SearchEvaluationCaseComparison["outcome"] {
  if (baseline.status === "failed" && candidate.status === "passed") return "candidate_win";
  if (baseline.status === "passed" && candidate.status === "failed") return "baseline_win";
  return "tie";
}

function observedOutcome(baselineWins: number, candidateWins: number): SearchEvaluationComparison["observedOutcome"] {
  if (baselineWins > 0 && candidateWins > 0) return "mixed";
  if (candidateWins > 0) return "candidate_better_observed";
  if (baselineWins > 0) return "baseline_better_observed";
  return "no_difference_observed";
}

function resultMap(results: readonly SearchEvaluationResult[]): Map<string, SearchEvaluationResult> {
  const byCase = new Map(results.map((result) => [result.caseId, result]));
  if (byCase.size !== results.length) {
    throw new SearchError("invalid_evaluation_comparison", "Cases in the search evaluation comparison results are duplicated.");
  }
  return byCase;
}

type SearchEvaluationComparisonCore = Omit<LegacySearchEvaluationComparison, "schemaVersion" | "comparisonId">;

function comparisonCore(evidence: SearchEvaluationComparisonEvidence): SearchEvaluationComparisonCore {
  const { bundle, coverage, cases, baseline, candidate } = evidence;
  assertSearchEvaluationBundle(bundle, cases);
  assertSearchEvaluationCoverage(coverage, bundle, cases);
  if (coverage.comparisonReadiness !== "ready") {
    throw new SearchError("evaluation_comparison_not_ready", "The candidate search cannot be compared because the sample is insufficient.");
  }
  const casesById = new Map(cases.map((evaluationCase) => [evaluationCase.caseId, evaluationCase]));
  const activeCases = coverage.activeCaseIds.map((caseId) => casesById.get(caseId)!);
  assertSearchEvaluationRun(baseline.run, activeCases, baseline.results);
  assertSearchEvaluationRun(candidate.run, activeCases, candidate.results);
  const baselineIndex = new LexicalSearchIndex(evidence.corpus);
  if (!sameSearchEngine(baseline.run.engine, SEARCH_ENGINE) || sameSearchEngine(candidate.run.engine, SEARCH_ENGINE) ||
    baseline.run.indexId !== baselineIndex.indexId || baseline.run.indexId === candidate.run.indexId ||
    baseline.run.projectId !== bundle.projectId || candidate.run.projectId !== bundle.projectId ||
    baseline.run.evaluatedAt !== candidate.run.evaluatedAt || baseline.run.caseIds.length !== coverage.activeCaseIds.length ||
    baseline.run.caseIds.some((caseId, index) => caseId !== coverage.activeCaseIds[index]) ||
    candidate.run.caseIds.some((caseId, index) => caseId !== coverage.activeCaseIds[index])) {
    throw new SearchError("invalid_evaluation_comparison", "Engine, project, timestamp, or case coordinates in the search evaluation comparison differ.");
  }
  const baselineByCase = resultMap(baseline.results);
  const candidateByCase = resultMap(candidate.results);
  const comparisons = coverage.activeCaseIds.map((caseId) => {
    const baselineResult = baselineByCase.get(caseId);
    const candidateResult = candidateByCase.get(caseId);
    if (baselineResult === undefined || candidateResult === undefined ||
      baselineResult.requestedLimit !== candidateResult.requestedLimit) {
      throw new SearchError("invalid_evaluation_comparison", "Result or ranking conditions in the search evaluation comparison differ.");
    }
    return {
      caseId,
      baselineResultId: baselineResult.resultId,
      candidateResultId: candidateResult.resultId,
      outcome: outcome(baselineResult, candidateResult),
    };
  });
  const baselineWins = comparisons.filter((item) => item.outcome === "baseline_win").length;
  const candidateWins = comparisons.filter((item) => item.outcome === "candidate_win").length;
  return {
    projectId: bundle.projectId,
    bundleId: bundle.bundleId,
    bundleHash: bundle.bundleHash,
    coverageId: coverage.coverageId,
    corpusDigest: baselineIndex.corpusDigest,
    evaluatedAt: baseline.run.evaluatedAt,
    baseline: runReference(baseline.run),
    candidate: runReference(candidate.run),
    cases: comparisons,
    totalCases: comparisons.length,
    baselineWins,
    candidateWins,
    ties: comparisons.length - baselineWins - candidateWins,
    observedOutcome: observedOutcome(baselineWins, candidateWins),
    candidateDecision: "not_determined" as const,
    embeddingDecision: "not_determined" as const,
  };
}

export function createSearchEvaluationComparison(input: {
  evidence: SearchEvaluationComparisonEvidence;
  candidateAdapterBuildId: string;
}): CurrentSearchEvaluationComparison {
  assertSearchAdapterBuildId(input.candidateAdapterBuildId, "invalid_evaluation_comparison");
  const core = {
    ...comparisonCore(input.evidence),
    candidateAdapterBuildId: input.candidateAdapterBuildId,
  };
  const comparison: CurrentSearchEvaluationComparison = {
    schemaVersion: 2,
    comparisonId: contentId("secmp", core),
    ...core,
  };
  assertSearchEvaluationComparison(comparison);
  return comparison;
}

function assertRunReference(reference: SearchEvaluationComparisonRunReference): void {
  if (typeof reference !== "object" || reference === null || !SEARCH_INDEX_ID_PATTERN.test(reference.indexId) ||
    !SEARCH_EVALUATION_RUN_PATTERN.test(reference.runId)) {
    throw new SearchError("invalid_evaluation_comparison", "Run coordinates in the search evaluation comparison are invalid.");
  }
  assertSearchEngineIdentity(reference.engine, "invalid_evaluation_comparison");
}

export function assertSearchEvaluationComparison(
  comparison: SearchEvaluationComparison,
  evidence?: SearchEvaluationComparisonEvidence,
): void {
  if (![1, 2].includes(comparison.schemaVersion) ||
    !SEARCH_EVALUATION_COMPARISON_PATTERN.test(comparison.comparisonId) ||
    !SOURCE_ID_PATTERN.test(comparison.projectId) || !SEARCH_EVALUATION_BUNDLE_ID_PATTERN.test(comparison.bundleId) ||
    comparison.bundleId.length > 100 || !SHA256_PATTERN.test(comparison.bundleHash) ||
    !/^secov_[a-f0-9]{24}$/.test(comparison.coverageId) || !SHA256_PATTERN.test(comparison.corpusDigest) ||
    !Array.isArray(comparison.cases) || comparison.cases.length < 1 || comparison.cases.length > 64 ||
    comparison.cases.some((item) => !SEARCH_EVALUATION_CASE_PATTERN.test(item.caseId) ||
      !SEARCH_EVALUATION_RESULT_PATTERN.test(item.baselineResultId) ||
      !SEARCH_EVALUATION_RESULT_PATTERN.test(item.candidateResultId) ||
      !["baseline_win", "candidate_win", "tie"].includes(item.outcome)) ||
    comparison.cases.some((item, index) => index > 0 &&
      compareText(comparison.cases[index - 1]!.caseId, item.caseId) >= 0) ||
    !Number.isSafeInteger(comparison.totalCases) || comparison.totalCases !== comparison.cases.length ||
    !Number.isSafeInteger(comparison.baselineWins) || comparison.baselineWins < 0 ||
    comparison.baselineWins !== comparison.cases.filter((item) => item.outcome === "baseline_win").length ||
    !Number.isSafeInteger(comparison.candidateWins) || comparison.candidateWins < 0 ||
    comparison.candidateWins !== comparison.cases.filter((item) => item.outcome === "candidate_win").length ||
    !Number.isSafeInteger(comparison.ties) || comparison.ties < 0 ||
    comparison.ties !== comparison.cases.filter((item) => item.outcome === "tie").length ||
    comparison.observedOutcome !== observedOutcome(comparison.baselineWins, comparison.candidateWins) ||
    comparison.candidateDecision !== "not_determined" || comparison.embeddingDecision !== "not_determined") {
    throw new SearchError("invalid_evaluation_comparison", "The search evaluation comparison contract is invalid.");
  }
  assertTimestamp(comparison.evaluatedAt, "invalid_evaluation_comparison");
  assertRunReference(comparison.baseline);
  assertRunReference(comparison.candidate);
  if (comparison.schemaVersion === 2) {
    assertSearchAdapterBuildId(comparison.candidateAdapterBuildId, "invalid_evaluation_comparison");
  }
  if (!sameSearchEngine(comparison.baseline.engine, SEARCH_ENGINE) ||
    sameSearchEngine(comparison.candidate.engine, SEARCH_ENGINE)) {
    throw new SearchError("invalid_evaluation_comparison", "Baseline or candidate search engine coordinates are invalid.");
  }
  if (evidence !== undefined) {
    const expectedCore = comparisonCore(evidence);
    const expectedId = comparison.schemaVersion === 2
      ? contentId("secmp", { ...expectedCore, candidateAdapterBuildId: comparison.candidateAdapterBuildId })
      : contentId("secmp", expectedCore);
    if (expectedId !== comparison.comparisonId) {
      throw new SearchError("invalid_evaluation_comparison", "The search evaluation comparison differs from its source runs.");
    }
    return;
  }
  const { schemaVersion: _schema, comparisonId: _id, ...core } = comparison;
  if (contentId("secmp", core) !== comparison.comparisonId) {
    throw new SearchError("invalid_evaluation_comparison", "The search evaluation comparison ID does not match its content.");
  }
}
