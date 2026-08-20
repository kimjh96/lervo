import { SEARCH_CANDIDATE_REVIEW_PATTERN } from "./evaluation-review.js";
import { SEARCH_CANDIDATE_ID_PATTERN } from "./evaluation-engine-registry.js";
import { assertSearchAdapterBuildId, assertSearchEngineIdentity, sameSearchEngine } from "./evaluation-engine.js";
import { assertSearchRolloutQualitySnapshot } from "./rollout-quality-snapshot.js";
import { assertSearchRolloutReview, SEARCH_ROLLOUT_REVIEW_PATTERN } from "./rollout-review.js";
import type {
  SearchRolloutCurrentSelection,
  SearchRolloutReviewStatusItem,
  SearchRolloutStatusEvidence,
  SearchRolloutStatusPage,
} from "./rollout-status-types.js";
import { SEARCH_ENGINE, SearchError } from "./types.js";
import { SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_ROLLOUT_STATUS_DEFAULT_LIMIT = 20;
export const SEARCH_ROLLOUT_STATUS_MAX_LIMIT = 50;

function compareNewest(left: SearchRolloutStatusEvidence, right: SearchRolloutStatusEvidence): number {
  const time = Date.parse(right.review.reviewedAt) - Date.parse(left.review.reviewedAt);
  if (time !== 0) return time;
  return left.review.rolloutReviewId < right.review.rolloutReviewId
    ? 1
    : left.review.rolloutReviewId > right.review.rolloutReviewId ? -1 : 0;
}

function assertCurrentSelection(selection: SearchRolloutCurrentSelection): void {
  assertSearchEngineIdentity(selection.engine, "invalid_rollout_status");
  if (!["implicit_baseline", "recorded_baseline", "candidate"].includes(selection.selectionState) ||
    !["not_applicable", "bound", "legacy_unbound"].includes(selection.buildEvidenceState)) {
    throw new SearchError("invalid_rollout_status", "현재 검색 rollout 선택 상태가 유효하지 않습니다.");
  }
  if (selection.selectionState === "implicit_baseline") {
    if (selection.selectionTransitionId !== null || selection.candidateId !== null ||
      selection.adapterBuildId !== null || selection.candidateReviewId !== null ||
      selection.buildEvidenceState !== "not_applicable" || !sameSearchEngine(selection.engine, SEARCH_ENGINE)) {
      throw new SearchError("invalid_rollout_status", "전이 없는 baseline rollout 상태가 유효하지 않습니다.");
    }
    return;
  }
  if (selection.selectionTransitionId === null || !/^seact_[a-f0-9]{24}$/.test(selection.selectionTransitionId)) {
    throw new SearchError("invalid_rollout_status", "현재 검색 rollout 선택 전이 ID가 유효하지 않습니다.");
  }
  if (selection.selectionState === "recorded_baseline") {
    if (selection.candidateId !== null || selection.adapterBuildId !== null || selection.candidateReviewId !== null ||
      selection.buildEvidenceState !== "not_applicable" || !sameSearchEngine(selection.engine, SEARCH_ENGINE)) {
      throw new SearchError("invalid_rollout_status", "기록된 baseline rollout 상태가 유효하지 않습니다.");
    }
    return;
  }
  if (sameSearchEngine(selection.engine, SEARCH_ENGINE) || selection.candidateId === null ||
    !SEARCH_CANDIDATE_ID_PATTERN.test(selection.candidateId) || selection.candidateReviewId === null ||
    !SEARCH_CANDIDATE_REVIEW_PATTERN.test(selection.candidateReviewId) ||
    selection.buildEvidenceState === "not_applicable" ||
    (selection.buildEvidenceState === "bound") !== (selection.adapterBuildId !== null)) {
    throw new SearchError("invalid_rollout_status", "현재 후보 검색 rollout 상태가 유효하지 않습니다.");
  }
  if (selection.adapterBuildId !== null) {
    assertSearchAdapterBuildId(selection.adapterBuildId, "invalid_rollout_status");
  }
}

export function createSearchRolloutStatusPage(input: {
  projectId: string;
  observedAt: Date;
  currentSelection: SearchRolloutCurrentSelection;
  evidence: readonly SearchRolloutStatusEvidence[];
  limit?: number;
  cursor?: string;
}): SearchRolloutStatusPage {
  const limit = input.limit ?? SEARCH_ROLLOUT_STATUS_DEFAULT_LIMIT;
  if (!SOURCE_ID_PATTERN.test(input.projectId) || !Number.isFinite(input.observedAt.getTime()) ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > SEARCH_ROLLOUT_STATUS_MAX_LIMIT ||
    (input.cursor !== undefined && !SEARCH_ROLLOUT_REVIEW_PATTERN.test(input.cursor))) {
    throw new SearchError("invalid_rollout_status", "검색 rollout 상태 조회 입력이 유효하지 않습니다.");
  }
  assertCurrentSelection(input.currentSelection);
  const seen = new Set<string>();
  const sorted = input.evidence.map((item) => {
    assertSearchRolloutReview(item.review);
    assertSearchRolloutQualitySnapshot(item.currentQualitySnapshot);
    if (seen.has(item.review.rolloutReviewId) || item.review.projectId !== input.projectId ||
      item.currentQualitySnapshot.observedThrough !== input.observedAt.toISOString()) {
      throw new SearchError("invalid_rollout_status", "검색 rollout 상태 근거의 project·시각 관계가 유효하지 않습니다.");
    }
    seen.add(item.review.rolloutReviewId);
    return structuredClone(item);
  }).sort(compareNewest);
  let start = 0;
  if (input.cursor !== undefined) {
    const cursorIndex = sorted.findIndex((item) => item.review.rolloutReviewId === input.cursor);
    if (cursorIndex < 0) {
      throw new SearchError("invalid_rollout_status", "검색 rollout 상태 cursor를 현재 원본에서 찾을 수 없습니다.");
    }
    start = cursorIndex + 1;
  }
  const selected = sorted.slice(start, start + limit);
  const reviews: SearchRolloutReviewStatusItem[] = selected.map((item) => ({
    review: item.review,
    currentQualitySnapshot: item.currentQualitySnapshot,
    qualityInputState: item.review.qualitySnapshot.inputDigest === item.currentQualitySnapshot.inputDigest
      ? "unchanged"
      : "changed",
    selectionRelation: item.review.target.selectionTransitionId === input.currentSelection.selectionTransitionId
      ? "current_selection"
      : "historical_selection",
  }));
  const nextCursor = start + selected.length < sorted.length
    ? selected.at(-1)!.review.rolloutReviewId
    : null;
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    observedAt: input.observedAt.toISOString(),
    currentSelection: structuredClone(input.currentSelection),
    reviewCount: sorted.length,
    pageLimit: limit,
    reviews,
    nextCursor,
    reviewDecisionSelection: "not_performed",
    effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
  };
}
