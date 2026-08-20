import { SEARCH_ENGINE_ACTIVATION_PATTERN } from "./engine-activation-validation.js";
import { contentId } from "./integrity.js";
import { searchRolloutActionEligibilityFailureReasons } from "./rollout-action-eligibility.js";
import { assertSearchRolloutActionPolicy } from "./rollout-action-policy.js";
import { SEARCH_ROLLOUT_POLICY_PATTERN } from "./rollout-policy-types.js";
import {
  assertSearchRolloutQualitySnapshot,
  SEARCH_ROLLOUT_SNAPSHOT_PATTERN,
} from "./rollout-quality-snapshot.js";
import { assertSearchRolloutReview, SEARCH_ROLLOUT_REVIEW_PATTERN } from "./rollout-review.js";
import type { SearchRolloutQualitySnapshot, SearchRolloutReview } from "./rollout-review-types.js";
import {
  SEARCH_ROLLOUT_ACKNOWLEDGEMENT_PATTERN,
  SEARCH_ROLLOUT_ACTION_POLICY_PATTERN,
  type SearchRolloutActionPolicy,
  type SearchRolloutActionPolicySources,
  type SearchRolloutKeepAcknowledgement,
} from "./rollout-action-types.js";
import { SearchError } from "./types.js";
import { assertTimestamp, SOURCE_ID_PATTERN } from "./validation.js";

export function assertSearchRolloutActionEligibility(input: {
  actionPolicy: SearchRolloutActionPolicy;
  rolloutPolicy: SearchRolloutActionPolicySources["rolloutPolicy"];
  review: SearchRolloutReview;
  currentQualitySnapshot: SearchRolloutQualitySnapshot;
  currentSelectionTransitionId: string | null;
  operatorId: string;
  actedAt: Date;
}): void {
  assertSearchRolloutActionPolicy(input.actionPolicy);
  assertSearchRolloutReview(input.review);
  assertSearchRolloutQualitySnapshot(input.currentQualitySnapshot);
  if (!SOURCE_ID_PATTERN.test(input.operatorId) || !Number.isFinite(input.actedAt.getTime()) ||
    input.actionPolicy.projectId !== input.review.projectId ||
    input.actionPolicy.rolloutPolicyId !== input.rolloutPolicy.policyId ||
    input.currentQualitySnapshot.observedThrough !== input.actedAt.toISOString()) {
    throw new SearchError(
      "rollout_action_not_eligible",
      "검색 rollout 검토·정책·operator·현재 품질 입력이 요청한 조치 조건을 충족하지 않습니다.",
    );
  }
  const failureReasons = searchRolloutActionEligibilityFailureReasons({
    ...input,
    requestedAction: input.actionPolicy.action,
    checkedAt: input.actedAt,
  });
  if (failureReasons.length > 0) {
    throw new SearchError(
      "rollout_action_not_eligible",
      "검색 rollout 검토·정책·operator·현재 품질 입력이 요청한 조치 조건을 충족하지 않습니다.",
    );
  }
}

export function createSearchRolloutKeepAcknowledgement(input: {
  actionPolicy: SearchRolloutActionPolicy;
  rolloutPolicy: SearchRolloutActionPolicySources["rolloutPolicy"];
  review: SearchRolloutReview;
  currentQualitySnapshot: SearchRolloutQualitySnapshot;
  currentSelectionTransitionId: string | null;
  operatorId: string;
  acknowledgedAt: Date;
}): SearchRolloutKeepAcknowledgement {
  assertSearchRolloutActionEligibility({ ...input, actedAt: input.acknowledgedAt });
  if (input.actionPolicy.action !== "acknowledge_keep") {
    throw new SearchError("rollout_action_not_eligible", "후보 유지 확인에는 keep 조치 정책이 필요합니다.");
  }
  const core = {
    projectId: input.review.projectId,
    action: "acknowledge_keep" as const,
    actionPolicyId: input.actionPolicy.actionPolicyId,
    rolloutPolicyId: input.rolloutPolicy.policyId,
    rolloutReviewId: input.review.rolloutReviewId,
    selectionTransitionId: input.review.target.selectionTransitionId,
    qualitySnapshotId: input.currentQualitySnapshot.snapshotId,
    qualityInputDigest: input.currentQualitySnapshot.inputDigest,
    operatorId: input.operatorId,
    acknowledgedAt: input.acknowledgedAt.toISOString(),
    recordState: "acknowledgement_recorded" as const,
    effect: {
      selectionChange: "not_applied" as const,
      rollback: "not_executed" as const,
      approval: "not_granted" as const,
    },
  };
  const acknowledgement: SearchRolloutKeepAcknowledgement = {
    schemaVersion: 1,
    acknowledgementId: contentId("srack", core),
    ...core,
  };
  assertSearchRolloutKeepAcknowledgement(acknowledgement);
  return acknowledgement;
}

export function assertSearchRolloutKeepAcknowledgement(value: SearchRolloutKeepAcknowledgement): void {
  if (value.schemaVersion !== 1 || !SEARCH_ROLLOUT_ACKNOWLEDGEMENT_PATTERN.test(value.acknowledgementId) ||
    !SOURCE_ID_PATTERN.test(value.projectId) || value.action !== "acknowledge_keep" ||
    !SEARCH_ROLLOUT_ACTION_POLICY_PATTERN.test(value.actionPolicyId) ||
    !SEARCH_ROLLOUT_POLICY_PATTERN.test(value.rolloutPolicyId) ||
    !SEARCH_ROLLOUT_REVIEW_PATTERN.test(value.rolloutReviewId) ||
    !SEARCH_ENGINE_ACTIVATION_PATTERN.test(value.selectionTransitionId) ||
    !SEARCH_ROLLOUT_SNAPSHOT_PATTERN.test(value.qualitySnapshotId) ||
    !/^sha256:[a-f0-9]{64}$/.test(value.qualityInputDigest) || !SOURCE_ID_PATTERN.test(value.operatorId) ||
    value.recordState !== "acknowledgement_recorded" || value.effect?.selectionChange !== "not_applied" ||
    value.effect.rollback !== "not_executed" || value.effect.approval !== "not_granted") {
    throw new SearchError("invalid_rollout_action", "검색 rollout 후보 유지 확인 계약이 유효하지 않습니다.");
  }
  assertTimestamp(value.acknowledgedAt, "invalid_rollout_action");
  const { schemaVersion: _schema, acknowledgementId: _id, ...core } = value;
  if (contentId("srack", core) !== value.acknowledgementId) {
    throw new SearchError("invalid_rollout_action", "검색 rollout 후보 유지 확인 ID가 실제 내용과 다릅니다.");
  }
}
