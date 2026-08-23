import {
  compareText,
  SEARCH_EVALUATION_CASE_PATTERN,
  SEARCH_EVALUATION_RESULT_PATTERN,
  SEARCH_EVALUATION_RUN_PATTERN,
} from "./evaluation-common.js";
import {
  SEARCH_EVALUATION_MAX_CASES,
  searchEvaluationFailureReasons,
  type SearchEvaluationCase,
  type SearchEvaluationResult,
  type SearchEvaluationRun,
} from "./evaluation-types.js";
import { assertSearchEvaluationCase } from "./evaluation-case.js";
import { assertSearchEvaluationResult } from "./evaluation-result.js";
import { contentId } from "./integrity.js";
import {
  assertSearchEngineIdentity,
  SEARCH_INDEX_ID_PATTERN,
  sameSearchEngine,
} from "./evaluation-engine.js";
import { SearchError } from "./types.js";
import { assertTimestamp, SOURCE_ID_PATTERN } from "./validation.js";

function emptyFailureCounts(): SearchEvaluationRun["failuresByReason"] {
  return {
    expected_source_missing: 0,
    low_rank: 0,
    no_results: 0,
  };
}

function pairCasesAndResults(
  cases: readonly SearchEvaluationCase[],
  results: readonly SearchEvaluationResult[],
): Array<{ evaluationCase: SearchEvaluationCase; result: SearchEvaluationResult }> {
  const resultsByCaseId = new Map(results.map((result) => [result.caseId, result]));
  if (resultsByCaseId.size !== results.length) {
    throw new SearchError("invalid_evaluation_run", "Cases in the search evaluation run results are duplicated.");
  }
  const pairs = cases.map((evaluationCase) => ({
    evaluationCase,
    result: resultsByCaseId.get(evaluationCase.caseId),
  }));
  if (pairs.some((pair) => pair.result === undefined)) {
    throw new SearchError("invalid_evaluation_run", "Case and result coordinates in the search evaluation run differ.");
  }
  return pairs
    .map((pair) => ({ evaluationCase: pair.evaluationCase, result: pair.result! }))
    .sort((left, right) => compareText(left.evaluationCase.caseId, right.evaluationCase.caseId));
}

export function createSearchEvaluationRun(input: {
  projectId: string;
  evaluatedAt: Date;
  cases: readonly SearchEvaluationCase[];
  results: readonly SearchEvaluationResult[];
}): SearchEvaluationRun {
  if (input.cases.length < 1 || input.cases.length > SEARCH_EVALUATION_MAX_CASES ||
    input.results.length !== input.cases.length) {
    throw new SearchError("invalid_evaluation_run", "The number of cases or results in the search evaluation run is invalid.");
  }
  const pairs = pairCasesAndResults(input.cases, input.results);
  for (const pair of pairs) {
    assertSearchEvaluationCase(pair.evaluationCase);
    assertSearchEvaluationResult(pair.result, pair.evaluationCase);
    if (pair.evaluationCase.projectId !== input.projectId || pair.result.projectId !== input.projectId ||
      pair.result.evaluatedAt !== input.evaluatedAt.toISOString() ||
      pair.result.indexId !== pairs[0]!.result.indexId ||
      !sameSearchEngine(pair.result.engine, pairs[0]!.result.engine)) {
      throw new SearchError("invalid_evaluation_run", "Project, timestamp, or index coordinates in the search evaluation run differ.");
    }
  }
  const failuresByReason = emptyFailureCounts();
  for (const { result } of pairs) {
    if (result.failureReason !== null) failuresByReason[result.failureReason] += 1;
  }
  const failedCases = pairs.filter(({ result }) => result.status === "failed").length;
  const core = {
    projectId: input.projectId,
    evaluatedAt: input.evaluatedAt.toISOString(),
    engine: { ...pairs[0]!.result.engine },
    indexId: pairs[0]!.result.indexId,
    caseIds: pairs.map(({ evaluationCase }) => evaluationCase.caseId),
    resultIds: pairs.map(({ result }) => result.resultId),
    totalCases: pairs.length,
    passedCases: pairs.length - failedCases,
    failedCases,
    regressions: pairs.filter(({ result }) => result.comparisonToReference === "regressed").length,
    improvements: pairs.filter(({ result }) => result.comparisonToReference === "improved").length,
    failuresByReason,
    baselineState: failedCases === 0 ? "all_passed" as const : "failures_observed" as const,
    embeddingDecision: "not_determined" as const,
  };
  const run: SearchEvaluationRun = {
    schemaVersion: 1,
    runId: contentId("sevr", core),
    ...core,
  };
  assertSearchEvaluationRun(run);
  return run;
}

export function assertSearchEvaluationRun(
  run: SearchEvaluationRun,
  cases?: readonly SearchEvaluationCase[],
  results?: readonly SearchEvaluationResult[],
): void {
  if (run.schemaVersion !== 1 || !SEARCH_EVALUATION_RUN_PATTERN.test(run.runId) ||
    !SOURCE_ID_PATTERN.test(run.projectId) || !SEARCH_INDEX_ID_PATTERN.test(run.indexId) ||
    !Array.isArray(run.caseIds) || !Array.isArray(run.resultIds) || run.caseIds.length < 1 ||
    run.caseIds.length > SEARCH_EVALUATION_MAX_CASES || run.resultIds.length !== run.caseIds.length ||
    run.caseIds.some((id) => !SEARCH_EVALUATION_CASE_PATTERN.test(id)) ||
    run.resultIds.some((id) => !SEARCH_EVALUATION_RESULT_PATTERN.test(id)) ||
    new Set(run.caseIds).size !== run.caseIds.length || new Set(run.resultIds).size !== run.resultIds.length ||
    run.caseIds.some((id, index) => index > 0 && run.caseIds[index - 1]! >= id) ||
    !Number.isSafeInteger(run.totalCases) || run.totalCases !== run.caseIds.length ||
    !Number.isSafeInteger(run.passedCases) || !Number.isSafeInteger(run.failedCases) ||
    run.passedCases < 0 || run.failedCases < 0 || run.passedCases + run.failedCases !== run.totalCases ||
    !Number.isSafeInteger(run.regressions) || run.regressions < 0 || run.regressions > run.totalCases ||
    !Number.isSafeInteger(run.improvements) || run.improvements < 0 || run.improvements > run.totalCases ||
    run.regressions + run.improvements > run.totalCases ||
    !["all_passed", "failures_observed"].includes(run.baselineState) ||
    run.baselineState !== (run.failedCases === 0 ? "all_passed" : "failures_observed") ||
    run.embeddingDecision !== "not_determined" || typeof run.failuresByReason !== "object" ||
    run.failuresByReason === null || Object.keys(run.failuresByReason).sort().join(",") !==
      [...searchEvaluationFailureReasons].sort().join(",") ||
    searchEvaluationFailureReasons.some((reason) => !Number.isSafeInteger(run.failuresByReason[reason]) ||
      run.failuresByReason[reason] < 0) ||
    searchEvaluationFailureReasons.reduce((sum, reason) => sum + run.failuresByReason[reason], 0) !== run.failedCases) {
    throw new SearchError("invalid_evaluation_run", "The search evaluation run contract is invalid.");
  }
  assertSearchEngineIdentity(run.engine, "invalid_evaluation_run");
  assertTimestamp(run.evaluatedAt, "invalid_evaluation_run");
  if ((cases === undefined) !== (results === undefined)) {
    throw new SearchError("invalid_evaluation_run", "Search evaluation run verification requires both cases and results.");
  }
  if (cases !== undefined && results !== undefined) {
    if (cases.length !== results.length) {
      throw new SearchError("invalid_evaluation_run", "Case and result counts in the search evaluation run differ.");
    }
    const pairs = pairCasesAndResults(cases, results);
    if (pairs.length !== run.totalCases) {
      throw new SearchError("invalid_evaluation_run", "The search evaluation run source count differs.");
    }
    for (const { evaluationCase, result } of pairs) {
      assertSearchEvaluationCase(evaluationCase);
      assertSearchEvaluationResult(result, evaluationCase);
    }
    const expected = createSearchEvaluationRun({
      projectId: run.projectId,
      evaluatedAt: new Date(run.evaluatedAt),
      cases: pairs.map(({ evaluationCase }) => evaluationCase),
      results: pairs.map(({ result }) => result),
    });
    if (expected.runId !== run.runId) {
      throw new SearchError("invalid_evaluation_run", "The search evaluation run differs from its case or result sources.");
    }
    return;
  }
  const { schemaVersion: _schema, runId: _id, ...core } = run;
  if (contentId("sevr", core) !== run.runId) {
    throw new SearchError("invalid_evaluation_run", "The search evaluation run ID does not match its content.");
  }
}
