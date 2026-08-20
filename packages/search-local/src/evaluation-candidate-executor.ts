import {
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
    if (sameSearchEngine(input.engine.engine, SEARCH_ENGINE)) {
      throw new Error("후보 엔진은 현재 lexical-v1과 다른 좌표여야 합니다.");
    }
    const index = await input.engine.buildIndex(structuredClone(input.corpus));
    if (!sameSearchEngine(index.engine, input.engine.engine)) {
      throw new Error("후보 index가 선언한 엔진 좌표와 다릅니다.");
    }
    return {
      ...await executeSearchEvaluation({ index, cases: input.cases, evaluatedAt: input.evaluatedAt }),
      index,
    };
  } catch (error) {
    throw new SearchLocalError("evaluation_candidate_failed", "후보 검색 엔진 평가를 완료하지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}
