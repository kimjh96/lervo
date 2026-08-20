import { resolve } from "node:path";

import {
  assertSearchEvaluationComparison,
  assertSearchEvaluationResult,
  assertSearchEvaluationRun,
  createSearchEvaluationCoverage,
  SEARCH_EVALUATION_COMPARISON_PATTERN,
  type SearchEvaluationComparison,
  type SearchEvaluationComparisonEvidence,
  type SearchEvaluationResult,
  type SearchEvaluationRun,
} from "@lervo/search";

import { loadRegisteredDocumentCorpus } from "./corpus.js";
import { loadSearchEvaluationBundles } from "./evaluation-bundle-files.js";
import { loadSearchEvaluationCases } from "./evaluation-case-files.js";
import { selectSearchEvaluationCases } from "./evaluation-case-selection.js";
import { existingObservationSubdirectory, readObservation } from "./observation-files.js";
import { SearchLocalError } from "./types.js";

export interface LoadedSearchEvaluationComparison {
  comparison: SearchEvaluationComparison;
  evidence: SearchEvaluationComparisonEvidence;
  activeCases: ReturnType<typeof selectSearchEvaluationCases>;
}

export async function loadStoredSearchEvaluationComparison(
  repositoryRoot: string,
  comparisonId: string,
): Promise<SearchEvaluationComparison> {
  if (!SEARCH_EVALUATION_COMPARISON_PATTERN.test(comparisonId)) {
    throw new SearchLocalError("evaluation_comparison_not_found", "검색 후보 비교 ID가 유효하지 않습니다.");
  }
  const comparisonPath = await requiredDirectory(repositoryRoot, "evaluation-comparisons");
  let comparison: SearchEvaluationComparison;
  try {
    comparison = await readObservation<SearchEvaluationComparison>(
      resolve(comparisonPath, `${comparisonId}.json`),
    );
  } catch (error) {
    if (error instanceof SearchLocalError && error.code === "observation_read_failed" &&
      (error.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new SearchLocalError("evaluation_comparison_not_found", "검색 후보 비교 원본을 찾을 수 없습니다.");
    }
    throw error;
  }
  assertSearchEvaluationComparison(comparison);
  if (comparison.comparisonId !== comparisonId) {
    throw new SearchLocalError("observation_invalid", "검색 후보 비교 ID가 파일 좌표와 다릅니다.");
  }
  return comparison;
}

async function requiredDirectory(repositoryRoot: string, name: "evaluation-comparisons" | "evaluation-results" |
  "evaluation-runs"): Promise<string> {
  const directory = await existingObservationSubdirectory(repositoryRoot, name);
  if (directory === null) {
    throw new SearchLocalError("evaluation_comparison_not_found", "검색 후보 비교 원본을 찾을 수 없습니다.");
  }
  return directory;
}

async function loadRun(path: string, runId: string): Promise<SearchEvaluationRun> {
  const run = await readObservation<SearchEvaluationRun>(resolve(path, `${runId}.json`));
  assertSearchEvaluationRun(run);
  if (run.runId !== runId) throw new SearchLocalError("observation_invalid", "검색 평가 run 파일 좌표가 다릅니다.");
  return run;
}

async function loadResults(path: string, run: SearchEvaluationRun): Promise<SearchEvaluationResult[]> {
  const results: SearchEvaluationResult[] = [];
  for (const resultId of run.resultIds) {
    const result = await readObservation<SearchEvaluationResult>(resolve(path, `${resultId}.json`));
    assertSearchEvaluationResult(result);
    if (result.resultId !== resultId) {
      throw new SearchLocalError("observation_invalid", "검색 평가 result 파일 좌표가 다릅니다.");
    }
    results.push(result);
  }
  return results;
}

export async function loadSearchEvaluationComparison(input: {
  repositoryRoot: string;
  projectId: string;
  comparisonId: string;
}): Promise<LoadedSearchEvaluationComparison> {
  const comparison = await loadStoredSearchEvaluationComparison(input.repositoryRoot, input.comparisonId);
  if (comparison.projectId !== input.projectId) {
    throw new SearchLocalError("observation_invalid", "검색 후보 비교의 project 좌표가 다릅니다.");
  }
  const [cases, corpus, runsPath, resultsPath] = await Promise.all([
    loadSearchEvaluationCases(input.repositoryRoot),
    loadRegisteredDocumentCorpus(input.repositoryRoot),
    requiredDirectory(input.repositoryRoot, "evaluation-runs"),
    requiredDirectory(input.repositoryRoot, "evaluation-results"),
  ]);
  const bundles = await loadSearchEvaluationBundles({ repositoryRoot: input.repositoryRoot, cases });
  const bundle = bundles.find((item) => item.bundleId === comparison.bundleId &&
    item.bundleHash === comparison.bundleHash);
  if (bundle === undefined) {
    throw new SearchLocalError("evaluation_bundle_invalid", "검색 후보 비교의 현재 bundle 원본이 다릅니다.");
  }
  const coverage = createSearchEvaluationCoverage(bundle, cases);
  const activeCases = selectSearchEvaluationCases(cases, coverage.activeCaseIds);
  const [baselineRun, candidateRun] = await Promise.all([
    loadRun(runsPath, comparison.baseline.runId),
    loadRun(runsPath, comparison.candidate.runId),
  ]);
  const [baselineResults, candidateResults] = await Promise.all([
    loadResults(resultsPath, baselineRun),
    loadResults(resultsPath, candidateRun),
  ]);
  const evidence: SearchEvaluationComparisonEvidence = {
    bundle,
    coverage,
    cases,
    corpus,
    baseline: { run: baselineRun, results: baselineResults },
    candidate: { run: candidateRun, results: candidateResults },
  };
  assertSearchEvaluationComparison(comparison, evidence);
  return { comparison, evidence, activeCases };
}
