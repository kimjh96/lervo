import type {
  SearchEvaluationBundle,
  SearchEvaluationCase,
  SearchEvaluationCoverage,
  SearchEvaluationRun,
} from "@lervo/search";

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
    `  ${run.engine.id}-v${run.engine.version} · 케이스 ${run.totalCases}개`,
    `  통과 ${run.passedCases} · 실패 ${run.failedCases}`,
    `  회귀 ${run.regressions} · 개선 ${run.improvements}`,
    "  임베딩 도입 판단: 아직 결정하지 않음",
  ].join("\n") + "\n";
}

export function formatSearchEvaluationBundle(bundle: SearchEvaluationBundle): string {
  return [
    `검색 평가 묶음을 만들었습니다: ${bundle.bundleId}`,
    `  범위 ${bundle.scope.roleId} / ${bundle.scope.taskType}`,
    `  활성 case ${bundle.activeCaseIds.length}개 · 최소 표본 ${bundle.minimumActiveCases}개`,
    `  파일: .lervo/search-evaluations/${bundle.bundleId}.bundle.yaml`,
  ].join("\n") + "\n";
}

export function formatSearchEvaluationCoverage(coverage: SearchEvaluationCoverage): string {
  return [
    `검색 평가 표본: ${coverage.bundleId} · ${coverage.scope.roleId} / ${coverage.scope.taskType}`,
    `  활성 ${coverage.activeCases}개 · 최소 ${coverage.minimumActiveCases}개 · 부족 ${coverage.shortfall}개`,
    `  표본 상태: ${coverage.sampleState === "sufficient" ? "충분" : "부족"}`,
    `  후보 비교 준비: ${coverage.comparisonReadiness === "ready" ? "가능" : "표본 부족"}`,
    "  임베딩 도입 판단: 아직 결정하지 않음",
  ].join("\n") + "\n";
}
