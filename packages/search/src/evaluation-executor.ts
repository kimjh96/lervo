import {
  assertSearchEngineIdentity,
  SEARCH_INDEX_ID_PATTERN,
  sameSearchEngine,
  type SearchEvaluationIndexPort,
} from "./evaluation-engine.js";
import { assertSearchEvaluationResponse } from "./evaluation-engine-contract.js";
import { createSearchEvaluationResult } from "./evaluation-result.js";
import { createSearchEvaluationRun } from "./evaluation-run.js";
import {
  SEARCH_EVALUATION_MAX_CASES,
  type SearchEvaluationCase,
  type SearchEvaluationResult,
  type SearchEvaluationRun,
} from "./evaluation-types.js";
import { SEARCH_MAX_RESULTS, SearchError } from "./types.js";

export interface SearchEvaluationExecution {
  run: SearchEvaluationRun;
  results: SearchEvaluationResult[];
}

export async function executeSearchEvaluation(input: {
  index: SearchEvaluationIndexPort;
  cases: readonly SearchEvaluationCase[];
  evaluatedAt: Date;
}): Promise<SearchEvaluationExecution> {
  assertSearchEngineIdentity(input.index.engine);
  if (
    !SEARCH_INDEX_ID_PATTERN.test(input.index.indexId) ||
    input.cases.length < 1 ||
    input.cases.length > SEARCH_EVALUATION_MAX_CASES ||
    !Number.isFinite(input.evaluatedAt.getTime())
  ) {
    throw new SearchError(
      "invalid_evaluation_engine",
      "The search evaluation index or case input is invalid.",
    );
  }
  const results: SearchEvaluationResult[] = [];
  for (const evaluationCase of input.cases) {
    const response = await input.index.search(evaluationCase.query, SEARCH_MAX_RESULTS);
    assertSearchEvaluationResponse({
      response,
      index: input.index,
      query: evaluationCase.query,
      limit: SEARCH_MAX_RESULTS,
    });
    if (
      !sameSearchEngine(response.engine, input.index.engine) ||
      response.indexId !== input.index.indexId ||
      response.requestedLimit !== SEARCH_MAX_RESULTS
    ) {
      throw new SearchError(
        "invalid_evaluation_engine",
        "The search evaluation response differs from the requested engine, index, or ranking conditions.",
      );
    }
    results.push(
      createSearchEvaluationResult({ evaluationCase, response, evaluatedAt: input.evaluatedAt }),
    );
  }
  return {
    results,
    run: createSearchEvaluationRun({
      projectId: input.cases[0]!.projectId,
      evaluatedAt: input.evaluatedAt,
      cases: input.cases,
      results,
    }),
  };
}
