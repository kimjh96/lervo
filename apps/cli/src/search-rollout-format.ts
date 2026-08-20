import type {
  SearchRolloutReview,
  SearchRolloutReviewDecision,
  SearchRolloutPolicyAssessment,
  SearchEngineRolloutRollback,
  SearchRolloutActionPolicy,
  SearchRolloutKeepAcknowledgement,
  SearchRolloutActionStatusPage,
  SearchRolloutReviewPolicy,
  SearchRolloutStatusPage,
} from "@lervo/search";

function decisionLabel(decision: SearchRolloutReviewDecision): string {
  if (decision === "keep_candidate") return "후보 유지";
  if (decision === "rollback_recommended") return "롤백 권고";
  return "추가 평가 필요";
}

export function formatSearchRolloutActionPolicy(policy: SearchRolloutActionPolicy): string {
  return [
    `검색 rollout 조치 정책을 만들었습니다: ${policy.actionPolicyId}`,
    `  조치: ${policy.action === "acknowledge_keep" ? "후보 유지 확인" : "rollback 실행"}`,
    `  허용 operator ${policy.allowedOperatorIds.length}명 · 검토 정책 ${policy.rolloutPolicyId}`,
    `  엔진 정책: ${policy.engineActivationPolicyId ?? "사용하지 않음"}`,
    `  파일: .lervo/search-rollout-action-policies/${policy.actionPolicyId}.yaml`,
  ].join("\n") + "\n";
}

export function formatSearchRolloutActionResult(
  result: SearchRolloutKeepAcknowledgement | SearchEngineRolloutRollback,
): string {
  if (result.schemaVersion === 1) {
    return [
      `검색 후보 유지 확인을 기록했습니다: ${result.acknowledgementId}`,
      `  rollout 검토: ${result.rolloutReviewId}`,
      `  operator: ${result.operatorId}`,
      "  현재 검색 엔진 선택은 바꾸지 않았으며 승인으로 사용하지 않습니다.",
    ].join("\n") + "\n";
  }
  return [
    `검색 rollout rollback을 기록했습니다: ${result.activationId}`,
    `  rollout 검토: ${result.rolloutAction.rolloutReviewId}`,
    `  ${result.previousSelection.engine.id}-v${result.previousSelection.engine.version}` +
      ` → ${result.selected.engine.id}-v${result.selected.engine.version}`,
    `  operator: ${result.operatorId} · 선택 전이 ${result.sequence}번`,
    "  검토·조치 정책·확인한 품질 입력이 이 rollback 전이에 함께 기록되었습니다.",
  ].join("\n") + "\n";
}

export function formatSearchRolloutActionStatus(status: SearchRolloutActionStatusPage): string {
  const selection = status.currentSelection.selectionState === "implicit_baseline"
    ? "전이 없는 기본 lexical"
    : status.currentSelection.selectionState === "recorded_baseline"
      ? `기록된 baseline · ${status.currentSelection.selectionTransitionId}`
      : `${status.currentSelection.engine.id}-v${status.currentSelection.engine.version}` +
        ` · ${status.currentSelection.selectionTransitionId}`;
  return [
    "검색 rollout 조치 상태:",
    `  현재 선택: ${selection}`,
    `  조치 원본 ${status.actionCount}개 · 이번 페이지 ${status.actions.length}개`,
    ...status.actions.flatMap((item) => [
      `  ${item.actionId} · ${item.action === "acknowledge_keep" ? "후보 유지 확인" : "rollback 실행"}`,
      `    검토 ${item.review.rolloutReviewId} · 품질 입력 ${
        item.qualityInputState === "unchanged" ? "변경 없음" : "변경됨"}`,
      `    검토 대상 ${item.reviewSelectionRelation === "current_selection" ? "현재 선택" : "과거 선택"}` +
        (item.actionTransitionRelation === "not_applicable"
          ? " · 별도 선택 전이 없음"
          : ` · rollback 결과 ${
            item.actionTransitionRelation === "current_selection" ? "현재 선택" : "과거 선택"}`),
    ]),
    status.nextCursor === null ? "  다음 페이지 없음" : `  다음 cursor: ${status.nextCursor}`,
    "  이 조회는 조치를 자동 선택하거나 rollback·승인을 실행하지 않습니다.",
  ].join("\n") + "\n";
}

export function formatSearchRolloutReview(review: SearchRolloutReview): string {
  const lines = [
    `검색 rollout 검토를 기록했습니다: ${review.rolloutReviewId}`,
    `  판단: ${decisionLabel(review.decision)}`,
    `  기준 정책: ${review.schemaVersion === 2 ? review.rolloutPolicyId : "연결하지 않음 (기존 방식)"}`,
    `  근거: 시도 ${review.qualitySnapshot.totalAttempts} · 평가 ${review.qualitySnapshot.assessedAttempts}` +
      ` · 실패 ${review.qualitySnapshot.failedAttempts}`,
    "  이 기록은 승인이나 검색 엔진 변경을 실행하지 않습니다.",
  ];
  return `${lines.join("\n")}\n`;
}

export function formatSearchRolloutPolicy(policy: SearchRolloutReviewPolicy): string {
  return [
    `검색 rollout 검토 정책을 만들었습니다: ${policy.policyId}`,
    `  허용 검토자 ${policy.allowedReviewerIds.length}명 · 후보 ${policy.allowedCandidateIds.join(", ")}`,
    `  후보 유지: 평가 ${policy.rules.keepCandidate.minimumAssessedAttempts}개 이상` +
      ` · 실패 ${policy.rules.keepCandidate.maximumFailedAttempts}개 이하`,
    `  롤백 권고: 평가 ${policy.rules.rollbackRecommended.minimumAssessedAttempts}개 이상` +
      ` · 실패 ${policy.rules.rollbackRecommended.minimumFailedAttempts}개 이상`,
    `  파일: .lervo/search-rollout-policies/${policy.policyId}.yaml`,
    "  이 정책은 검토 가능 여부만 판단하며 결정 선택이나 검색 엔진 변경을 하지 않습니다.",
  ].join("\n") + "\n";
}

const failureLabels: Record<SearchRolloutPolicyAssessment["failureReasons"][number], string> = {
  policy_not_bound: "검토에 정책이 연결되지 않음",
  policy_mismatch: "검토에 연결된 정책이 다름",
  policy_created_after_review: "정책이 검토 뒤에 만들어짐",
  reviewer_not_allowed: "허용되지 않은 검토자",
  candidate_not_allowed: "허용되지 않은 후보",
  insufficient_assessed_attempts: "평가된 시도 수 부족",
  too_many_failed_attempts: "허용 실패 수 초과",
  too_few_failed_attempts: "롤백 권고에 필요한 실패 수 부족",
};

export function formatSearchRolloutPolicyAssessment(assessment: SearchRolloutPolicyAssessment): string {
  const reasons = assessment.failureReasons.length === 0
    ? "없음"
    : assessment.failureReasons.map((reason) => failureLabels[reason]).join(", ");
  return [
    `검색 rollout 검토 정책 확인: ${assessment.rolloutReviewId}`,
    `  정책 연결: ${assessment.policyBindingState === "bound" ? "일치" :
      assessment.policyBindingState === "legacy_unbound" ? "연결되지 않은 기존 검토" : "다른 정책"}`,
    `  기록된 판단: ${assessment.reviewDecisionEligibility === "eligible" ? "기준 충족" : "기준 미충족"}`,
    `  미충족 사유: ${reasons}`,
    "  이 확인은 판단을 대신 선택하거나 승인·롤백·검색 엔진 변경을 실행하지 않습니다.",
  ].join("\n") + "\n";
}

export function formatSearchRolloutStatus(status: SearchRolloutStatusPage): string {
  const selection = status.currentSelection.selectionState === "implicit_baseline"
    ? "전이 없는 기본 lexical"
    : status.currentSelection.selectionState === "recorded_baseline"
      ? `기록된 baseline · ${status.currentSelection.selectionTransitionId}`
      : `${status.currentSelection.engine.id}-v${status.currentSelection.engine.version}` +
        ` · ${status.currentSelection.selectionTransitionId}`;
  const lines = [
    "검색 rollout 검토 상태:",
    `  현재 선택: ${selection}`,
    `  검토 원본 ${status.reviewCount}개 · 이번 페이지 ${status.reviews.length}개`,
    ...status.reviews.flatMap((item) => [
      `  ${item.review.rolloutReviewId} · ${decisionLabel(item.review.decision)}`,
      `    ${item.selectionRelation === "current_selection" ? "현재 선택" : "과거 선택"}` +
        ` · 품질 입력 ${item.qualityInputState === "unchanged" ? "변경 없음" : "변경됨"}`,
      `    현재 시도 ${item.currentQualitySnapshot.totalAttempts} · 평가 ` +
        `${item.currentQualitySnapshot.assessedAttempts} · 실패 ${item.currentQualitySnapshot.failedAttempts}`,
    ]),
    status.nextCursor === null ? "  다음 페이지 없음" : `  다음 cursor: ${status.nextCursor}`,
    "  이 조회는 검토를 승인으로 선택하거나 검색 엔진을 변경하지 않습니다.",
  ];
  return `${lines.join("\n")}\n`;
}
