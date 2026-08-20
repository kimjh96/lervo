import type { SearchEvaluationCase } from "@lervo/search";

import { SearchLocalError } from "./types.js";

export function selectSearchEvaluationCases(
  availableCases: readonly SearchEvaluationCase[],
  caseIds: readonly string[],
): SearchEvaluationCase[] {
  const requested = new Set(caseIds);
  if (requested.size !== caseIds.length || requested.size === 0) {
    throw new SearchLocalError("evaluation_bundle_invalid", "평가 묶음의 활성 case 선택이 비어 있거나 중복되었습니다.");
  }
  const byId = new Map(availableCases.map((evaluationCase) => [evaluationCase.caseId, evaluationCase]));
  if (byId.size !== availableCases.length || [...requested].some((caseId) => !byId.has(caseId))) {
    throw new SearchLocalError("evaluation_bundle_invalid", "평가 묶음이 존재하지 않거나 중복된 case를 선택했습니다.");
  }
  return [...requested].sort().map((caseId) => byId.get(caseId)!);
}
