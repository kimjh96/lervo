import type { SearchEvaluationCase, SearchEvaluationRun } from "@lervo/search";

export function formatSearchEvaluationCase(evaluationCase: SearchEvaluationCase): string {
  return [
    `검색 평가 케이스를 만들었습니다: ${evaluationCase.caseId}`,
    `  기대 원본 ${evaluationCase.expectation.sources.length}개 · ${evaluationCase.expectation.maximumRank}위 이내`,
    `  파일: .lervo/search-evaluations/${evaluationCase.caseId}.yaml`,
    "  이 파일에는 사용자가 확인한 검색 문장이 들어갑니다. 비밀정보가 없는지 커밋 전에 확인하세요.",
  ].join("\n") + "\n";
}

export function formatSearchEvaluationRun(run: SearchEvaluationRun): string {
  return [
    `검색 반복 평가: ${run.runId}`,
    `  lexical-v1 · 케이스 ${run.totalCases}개`,
    `  통과 ${run.passedCases} · 실패 ${run.failedCases}`,
    `  회귀 ${run.regressions} · 개선 ${run.improvements}`,
    "  임베딩 도입 판단: 아직 결정하지 않음",
  ].join("\n") + "\n";
}
