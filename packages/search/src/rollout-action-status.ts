import { assertSearchEngineActivation } from "./engine-activation-validation.js";
import { assertSearchRolloutKeepAcknowledgement } from "./rollout-action.js";
import { SEARCH_ROLLOUT_ACKNOWLEDGEMENT_PATTERN } from "./rollout-action-types.js";
import { assertSearchRolloutQualitySnapshot } from "./rollout-quality-snapshot.js";
import { assertSearchRolloutReview } from "./rollout-review.js";
import type {
  SearchRolloutActionStatusEvidence,
  SearchRolloutActionStatusItem,
  SearchRolloutActionStatusPage,
  SearchRolloutActionStatusRecord,
} from "./rollout-action-status-types.js";
import { assertSearchRolloutCurrentSelection } from "./rollout-status.js";
import type { SearchRolloutCurrentSelection } from "./rollout-status-types.js";
import { SearchError } from "./types.js";
import { SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_ROLLOUT_ACTION_STATUS_DEFAULT_LIMIT = 20;
export const SEARCH_ROLLOUT_ACTION_STATUS_MAX_LIMIT = 50;

function recordCoordinates(record: SearchRolloutActionStatusRecord): {
  actionId: string;
  action: SearchRolloutActionStatusItem["action"];
  actedAt: string;
  rolloutReviewId: string;
  selectionTransitionId: string;
  qualityInputDigest: string;
  rolloutPolicyId: string;
} {
  return record.schemaVersion === 1
    ? {
      actionId: record.acknowledgementId,
      action: "acknowledge_keep",
      actedAt: record.acknowledgedAt,
      rolloutReviewId: record.rolloutReviewId,
      selectionTransitionId: record.selectionTransitionId,
      qualityInputDigest: record.qualityInputDigest,
      rolloutPolicyId: record.rolloutPolicyId,
    }
    : {
      actionId: record.activationId,
      action: "execute_rollback",
      actedAt: record.decidedAt,
      rolloutReviewId: record.rolloutAction.rolloutReviewId,
      selectionTransitionId: record.previousActivationId!,
      qualityInputDigest: record.rolloutAction.qualityInputDigest,
      rolloutPolicyId: record.rolloutAction.rolloutPolicyId,
    };
}

function compareNewest(left: SearchRolloutActionStatusEvidence, right: SearchRolloutActionStatusEvidence): number {
  const leftCoordinates = recordCoordinates(left.record);
  const rightCoordinates = recordCoordinates(right.record);
  const time = Date.parse(rightCoordinates.actedAt) - Date.parse(leftCoordinates.actedAt);
  if (time !== 0) return time;
  return leftCoordinates.actionId < rightCoordinates.actionId
    ? 1
    : leftCoordinates.actionId > rightCoordinates.actionId ? -1 : 0;
}

function assertEvidence(input: {
  projectId: string;
  observedAt: Date;
  evidence: SearchRolloutActionStatusEvidence;
}): ReturnType<typeof recordCoordinates> {
  const { record, review, currentQualitySnapshot } = input.evidence;
  if (record.schemaVersion === 1) assertSearchRolloutKeepAcknowledgement(record);
  else assertSearchEngineActivation(record);
  assertSearchRolloutReview(review);
  assertSearchRolloutQualitySnapshot(currentQualitySnapshot);
  const coordinates = recordCoordinates(record);
  const actionPolicyId = record.schemaVersion === 1
    ? record.actionPolicyId
    : record.rolloutAction.actionPolicyId;
  const invalidKeep = record.schemaVersion === 1 && (
    record.selectionTransitionId !== review.target.selectionTransitionId ||
    record.rolloutPolicyId !== (review.schemaVersion === 2 ? review.rolloutPolicyId : null)
  );
  const invalidRollback = record.schemaVersion === 3 && (
    record.action !== "rollback" || record.previousActivationId !== review.target.selectionTransitionId ||
    record.rollbackOfActivationId !== review.target.selectionTransitionId ||
    record.rolloutAction.rolloutPolicyId !== (review.schemaVersion === 2 ? review.rolloutPolicyId : null)
  );
  if (record.projectId !== input.projectId || review.projectId !== input.projectId ||
    currentQualitySnapshot.observedThrough !== input.observedAt.toISOString() ||
    coordinates.rolloutReviewId !== review.rolloutReviewId || review.schemaVersion !== 2 ||
    coordinates.qualityInputDigest !== review.qualitySnapshot.inputDigest ||
    Date.parse(coordinates.actedAt) < Date.parse(review.reviewedAt) ||
    Date.parse(coordinates.actedAt) > input.observedAt.getTime() ||
    !/^srapol_[a-f0-9]{24}$/.test(actionPolicyId) || invalidKeep || invalidRollback) {
    throw new SearchError("invalid_rollout_action_status", "검색 rollout 조치 상태 근거 관계가 유효하지 않습니다.");
  }
  return coordinates;
}

export function createSearchRolloutActionStatusPage(input: {
  projectId: string;
  observedAt: Date;
  currentSelection: SearchRolloutCurrentSelection;
  evidence: readonly SearchRolloutActionStatusEvidence[];
  limit?: number;
  cursor?: string;
}): SearchRolloutActionStatusPage {
  const limit = input.limit ?? SEARCH_ROLLOUT_ACTION_STATUS_DEFAULT_LIMIT;
  const validCursor = input.cursor === undefined || SEARCH_ROLLOUT_ACKNOWLEDGEMENT_PATTERN.test(input.cursor) ||
    /^seact_[a-f0-9]{24}$/.test(input.cursor);
  if (!SOURCE_ID_PATTERN.test(input.projectId) || !Number.isFinite(input.observedAt.getTime()) ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > SEARCH_ROLLOUT_ACTION_STATUS_MAX_LIMIT || !validCursor) {
    throw new SearchError("invalid_rollout_action_status", "검색 rollout 조치 상태 조회 입력이 유효하지 않습니다.");
  }
  assertSearchRolloutCurrentSelection(input.currentSelection);
  const seen = new Set<string>();
  const sorted = input.evidence.map((evidence) => {
    const cloned = structuredClone(evidence);
    const coordinates = assertEvidence({ projectId: input.projectId, observedAt: input.observedAt, evidence: cloned });
    if (seen.has(coordinates.actionId)) {
      throw new SearchError("invalid_rollout_action_status", "검색 rollout 조치 상태에 중복 원본이 있습니다.");
    }
    seen.add(coordinates.actionId);
    return cloned;
  }).sort(compareNewest);
  let start = 0;
  if (input.cursor !== undefined) {
    const cursorIndex = sorted.findIndex((item) => recordCoordinates(item.record).actionId === input.cursor);
    if (cursorIndex < 0) {
      throw new SearchError("invalid_rollout_action_status", "검색 rollout 조치 상태 cursor를 찾을 수 없습니다.");
    }
    start = cursorIndex + 1;
  }
  const selected = sorted.slice(start, start + limit);
  const actions = selected.map((evidence): SearchRolloutActionStatusItem => {
    const coordinates = recordCoordinates(evidence.record);
    return {
      ...evidence,
      actionId: coordinates.actionId,
      action: coordinates.action,
      actedAt: coordinates.actedAt,
      qualityInputState: coordinates.qualityInputDigest === evidence.currentQualitySnapshot.inputDigest
        ? "unchanged"
        : "changed",
      reviewSelectionRelation: coordinates.selectionTransitionId === input.currentSelection.selectionTransitionId
        ? "current_selection"
        : "historical_selection",
      actionTransitionRelation: evidence.record.schemaVersion === 1
        ? "not_applicable"
        : evidence.record.activationId === input.currentSelection.selectionTransitionId
          ? "current_selection"
          : "historical_selection",
    };
  });
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    observedAt: input.observedAt.toISOString(),
    currentSelection: structuredClone(input.currentSelection),
    actionCount: sorted.length,
    pageLimit: limit,
    actions,
    nextCursor: start + selected.length < sorted.length ? actions.at(-1)!.actionId : null,
    actionSelection: "not_performed",
    effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
  };
}
