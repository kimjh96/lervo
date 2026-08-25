import {
  assertSearchAdapterBuildId,
  assertSearchEngineIdentity,
  executeSearchEvaluation,
  sameSearchEngine,
  SEARCH_ENGINE,
  type SearchEvaluationCase,
  type SearchEvaluationEnginePort,
  type SearchEvaluationExecution,
  type SearchIndexPort,
  type SearchSourceInput,
} from "@lervo/search";

import { SearchLocalError } from "./types.js";

export interface LocalSearchCandidateExecution extends SearchEvaluationExecution {
  index: SearchIndexPort;
}

export async function executeLocalSearchCandidate(input: {
  engine: SearchEvaluationEnginePort;
  corpus: readonly SearchSourceInput[];
  cases: readonly SearchEvaluationCase[];
  evaluatedAt: Date;
}): Promise<LocalSearchCandidateExecution> {
  try {
    assertSearchEngineIdentity(input.engine.engine);
    assertSearchAdapterBuildId(input.engine.adapterBuildId);
    if (sameSearchEngine(input.engine.engine, SEARCH_ENGINE)) {
      throw new Error(
        "The candidate engine must have coordinates different from the current lexical-v1 engine.",
      );
    }
    const index = await input.engine.buildIndex(structuredClone(input.corpus));
    if (!sameSearchEngine(index.engine, input.engine.engine)) {
      throw new Error("The candidate index differs from its declared engine coordinates.");
    }
    return {
      ...(await executeSearchEvaluation({
        index,
        cases: input.cases,
        evaluatedAt: input.evaluatedAt,
      })),
      index,
    };
  } catch (error) {
    throw new SearchLocalError(
      "evaluation_candidate_failed",
      "Could not complete the candidate search engine evaluation.",
      {
        cause: error instanceof Error ? error : undefined,
      },
    );
  }
}
