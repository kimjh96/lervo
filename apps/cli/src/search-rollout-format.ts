import type {
  SearchRolloutReview,
  SearchRolloutReviewDecision,
  SearchRolloutStatusPage,
} from "@lervo/search";

function decisionLabel(decision: SearchRolloutReviewDecision): string {
  if (decision === "keep_candidate") return "후보 유지";
  if (decision === "rollback_recommended") return "롤백 권고";
  return "추가 평가 필요";
}

export function formatSearchRolloutReview(review: SearchRolloutReview): string {
  const lines = [
    `검색 rollout 검토를 기록했습니다: ${review.rolloutReviewId}`,
    `  판단: ${decisionLabel(review.decision)}`,
    `  근거: 시도 ${review.qualitySnapshot.totalAttempts} · 평가 ${review.qualitySnapshot.assessedAttempts}` +
      ` · 실패 ${review.qualitySnapshot.failedAttempts}`,
    "  이 기록은 승인이나 검색 엔진 변경을 실행하지 않습니다.",
  ];
  return `${lines.join("\n")}\n`;
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
