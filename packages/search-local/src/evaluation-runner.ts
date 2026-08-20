import {
  createSearchEvaluationResult,
  createSearchEvaluationRun,
  LexicalSearchIndex,
  SEARCH_MAX_RESULTS,
  type SearchEvaluationResult,
  type SearchEvaluationRun,
  type SearchEvaluationCase,
} from "@lervo/search";

import { loadRegisteredDocumentCorpus } from "./corpus.js";
import { loadSearchEvaluationCases } from "./evaluation-case-files.js";
import { LocalSearchEvaluationStore } from "./evaluation-store.js";
import { SearchLocalError } from "./types.js";

export interface LocalSearchEvaluationOutput {
  run: SearchEvaluationRun;
  results: SearchEvaluationResult[];
}

export async function runLocalSearchEvaluation(input: {
  repositoryRoot: string;
  projectId: string;
  evaluatedAt: Date;
  caseIds?: readonly string[];
}): Promise<LocalSearchEvaluationOutput> {
  const [availableCases, corpus] = await Promise.all([
    loadSearchEvaluationCases(input.repositoryRoot),
    loadRegisteredDocumentCorpus(input.repositoryRoot),
  ]);
  let cases: SearchEvaluationCase[];
  if (input.caseIds === undefined) cases = availableCases;
  else {
    const requested = new Set(input.caseIds);
    if (requested.size !== input.caseIds.length || requested.size === 0) {
      throw new SearchLocalError("evaluation_bundle_invalid", "평가 묶음의 활성 case 선택이 비어 있거나 중복되었습니다.");
    }
    const byId = new Map(availableCases.map((evaluationCase) => [evaluationCase.caseId, evaluationCase]));
    if ([...requested].some((caseId) => !byId.has(caseId))) {
      throw new SearchLocalError("evaluation_bundle_invalid", "평가 묶음이 존재하지 않는 case를 선택했습니다.");
    }
    cases = [...requested].sort().map((caseId) => byId.get(caseId)!);
  }
  if (cases.length === 0) {
    throw new SearchLocalError("evaluation_not_found", "반복 실행할 검색 평가 케이스가 없습니다.");
  }
  if (cases.some((evaluationCase) => evaluationCase.projectId !== input.projectId)) {
    throw new SearchLocalError("evaluation_case_invalid", "검색 평가 케이스의 project 좌표가 다릅니다.");
  }
  const index = new LexicalSearchIndex(corpus);
  const results = cases.map((evaluationCase) => createSearchEvaluationResult({
    evaluationCase,
    response: index.search(evaluationCase.query, SEARCH_MAX_RESULTS),
    evaluatedAt: input.evaluatedAt,
  }));
  const run = createSearchEvaluationRun({
    projectId: input.projectId,
    evaluatedAt: input.evaluatedAt,
    cases,
    results,
  });
  const store = await LocalSearchEvaluationStore.open(input.repositoryRoot);
  await store.record({ cases, results, run });
  return { run, results };
}
