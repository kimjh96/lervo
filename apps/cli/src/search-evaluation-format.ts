import type {
  SearchEvaluationBundle,
  SearchEvaluationCase,
  SearchEvaluationComparison,
  SearchEvaluationCoverage,
  SearchEvaluationRun,
  SearchCandidateReview,
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

export function formatSearchEvaluationComparison(comparison: SearchEvaluationComparison): string {
  const outcomes = {
    baseline_better_observed: "baseline 우세 관측",
    candidate_better_observed: "후보 우세 관측",
    mixed: "서로 다른 우세 관측",
    no_difference_observed: "통과 여부 차이 없음",
  } as const;
  return [
    `검색 후보 비교: ${comparison.comparisonId}`,
    `  묶음 ${comparison.bundleId} · 케이스 ${comparison.totalCases}개`,
    `  baseline ${comparison.baseline.engine.id}-v${comparison.baseline.engine.version}`,
    `  후보 ${comparison.candidate.engine.id}-v${comparison.candidate.engine.version}`,
    `  후보 승 ${comparison.candidateWins} · baseline 승 ${comparison.baselineWins} · 동률 ${comparison.ties}`,
    `  관측 결과: ${outcomes[comparison.observedOutcome]}`,
    "  후보 채택 판단: 아직 결정하지 않음",
    "  임베딩 도입 판단: 아직 결정하지 않음",
  ].join("\n") + "\n";
}

export function formatSearchCandidateReview(review: SearchCandidateReview): string {
  const decisions = {
    adopt_candidate: "채택 후보",
    reject_candidate: "기각",
    more_samples_required: "표본 추가 필요",
  } as const;
  return [
    `검색 후보 검토: ${review.reviewId}`,
    `  비교 ${review.comparisonId} · 후보 ${review.candidateId}`,
    `  결정: ${decisions[review.decision]}`,
    `  후보 replay: ${review.verification.candidateReplay === "matched" ? "일치" : "불일치"}`,
    `  다음 검토 상태: ${review.promotionReadiness}`,
    "  실제 엔진 활성화: 적용하지 않음",
    "  임베딩 도입 판단: 아직 결정하지 않음",
  ].join("\n") + "\n";
}
