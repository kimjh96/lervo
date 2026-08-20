import type { SearchEngineActivation } from "./engine-activation-types.js";
import { assertSearchEngineSelection, sameSearchEngineSelection } from "./engine-selection.js";
import { sameSearchEngine } from "./evaluation-engine.js";
import { contentId } from "./integrity.js";
import { SEARCH_ROLLOUT_ACTION_POLICY_PATTERN } from "./rollout-action-types.js";
import { SEARCH_ROLLOUT_POLICY_PATTERN } from "./rollout-policy-types.js";
import { SEARCH_ROLLOUT_SNAPSHOT_PATTERN } from "./rollout-quality-snapshot.js";
import { SEARCH_ROLLOUT_REVIEW_PATTERN } from "./rollout-review.js";
import { SearchError } from "./types.js";
import { assertTimestamp, SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_ENGINE_ACTIVATION_PATTERN = /^seact_[a-f0-9]{24}$/;

export function assertSearchEngineActivation(
  activation: SearchEngineActivation,
  previous?: SearchEngineActivation | null,
): void {
  const legacy = activation.schemaVersion === 1;
  const current = activation.schemaVersion === 2 || activation.schemaVersion === 3;
  const action = (activation as { action: string }).action;
  if ((!legacy && !current) || !SEARCH_ENGINE_ACTIVATION_PATTERN.test(activation.activationId) ||
    !SOURCE_ID_PATTERN.test(activation.projectId) || !Number.isSafeInteger(activation.sequence) ||
    activation.sequence < 1 || (activation.previousActivationId !== null &&
      !SEARCH_ENGINE_ACTIVATION_PATTERN.test(activation.previousActivationId)) ||
    (activation.rollbackOfActivationId !== null &&
      !SEARCH_ENGINE_ACTIVATION_PATTERN.test(activation.rollbackOfActivationId)) ||
    !["activate_candidate", "refresh_candidate", "rollback"].includes(activation.action) ||
    !/^sepol_[a-f0-9]{24}$/.test(activation.policyId) || !SOURCE_ID_PATTERN.test(activation.operatorId) ||
    activation.embeddingDecision !== "not_determined") {
    throw new SearchError("invalid_engine_activation", "검색 엔진 활성화 계약이 유효하지 않습니다.");
  }
  if (activation.schemaVersion === 3 && (activation.action !== "rollback" ||
    !SEARCH_ROLLOUT_ACTION_POLICY_PATTERN.test(activation.rolloutAction?.actionPolicyId) ||
    !SEARCH_ROLLOUT_POLICY_PATTERN.test(activation.rolloutAction.rolloutPolicyId) ||
    !SEARCH_ROLLOUT_REVIEW_PATTERN.test(activation.rolloutAction.rolloutReviewId) ||
    !SEARCH_ROLLOUT_SNAPSHOT_PATTERN.test(activation.rolloutAction.qualitySnapshotId) ||
    !/^sha256:[a-f0-9]{64}$/.test(activation.rolloutAction.qualityInputDigest))) {
    throw new SearchError("invalid_engine_activation", "검색 rollout rollback 근거가 유효하지 않습니다.");
  }
  if (activation.schemaVersion !== 3 && "rolloutAction" in activation) {
    throw new SearchError("invalid_engine_activation", "기존 검색 엔진 전이에 rollout 조치 근거가 있습니다.");
  }
  if (legacy) {
    const hasLegacyState = activation.applicationState === "not_connected" && activation.recordState === undefined;
    const hasInterimState = activation.recordState === "selection_recorded" && activation.applicationState === undefined;
    if (action === "refresh_candidate" || (!hasLegacyState && !hasInterimState) ||
      (activation.rollbackTargetActivationId !== null &&
        !SEARCH_ENGINE_ACTIVATION_PATTERN.test(activation.rollbackTargetActivationId))) {
      throw new SearchError("invalid_engine_activation", "기존 검색 엔진 활성화 계약이 유효하지 않습니다.");
    }
  } else if ((activation.fallbackActivationId !== null &&
    !SEARCH_ENGINE_ACTIVATION_PATTERN.test(activation.fallbackActivationId)) ||
    activation.recordState !== "selection_recorded") {
    throw new SearchError("invalid_engine_activation", "검색 엔진 활성화 fallback 계약이 유효하지 않습니다.");
  }
  assertTimestamp(activation.decidedAt, "invalid_engine_activation");
  assertSearchEngineSelection(activation.previousSelection);
  assertSearchEngineSelection(activation.selected);
  if (sameSearchEngineSelection(activation.previousSelection, activation.selected) ||
    (activation.sequence === 1) !== (activation.previousActivationId === null) ||
    (["activate_candidate", "refresh_candidate"].includes(activation.action) &&
      (activation.selected.mode !== "candidate" ||
      activation.rollbackOfActivationId !== null)) ||
    (activation.action === "refresh_candidate" && activation.previousActivationId === null) ||
    (activation.action === "rollback" && activation.rollbackOfActivationId !== activation.previousActivationId)) {
    throw new SearchError("invalid_engine_activation", "검색 엔진 활성화 전이 관계가 유효하지 않습니다.");
  }
  if (legacy && ((activation.action === "activate_candidate" &&
    activation.rollbackTargetActivationId !== activation.previousActivationId) ||
    (activation.action === "rollback" && activation.rollbackTargetActivationId === activation.previousActivationId))) {
    throw new SearchError("invalid_engine_activation", "기존 검색 엔진 활성화 전이 관계가 유효하지 않습니다.");
  }
  if (current) {
    assertSearchEngineSelection(activation.fallbackSelection);
    const invalidRefresh = activation.action === "refresh_candidate" && (
      activation.previousSelection.mode !== "candidate" || activation.selected.mode !== "candidate" ||
      activation.previousSelection.candidateId !== activation.selected.candidateId ||
      !sameSearchEngine(activation.previousSelection.engine, activation.selected.engine) ||
      activation.fallbackSelection.mode !== "baseline" || activation.fallbackActivationId !== null
    );
    const invalidOther = activation.action !== "refresh_candidate" && (
      !sameSearchEngineSelection(activation.fallbackSelection, activation.previousSelection) ||
      activation.fallbackActivationId !== activation.previousActivationId
    );
    if (invalidRefresh || invalidOther ||
      (activation.action === "rollback" && activation.rollbackOfActivationId === null)) {
      throw new SearchError("invalid_engine_activation", "검색 엔진 활성화 fallback 관계가 유효하지 않습니다.");
    }
  }
  if (previous !== undefined) {
    const invalidRoot = previous === null && activation.sequence !== 1;
    const invalidContinuation = previous !== null && (
      activation.projectId !== previous.projectId || activation.sequence !== previous.sequence + 1 ||
      activation.previousActivationId !== previous.activationId ||
      !sameSearchEngineSelection(activation.previousSelection, previous.selected) ||
      (legacy && activation.action === "rollback" &&
        (!sameSearchEngineSelection(activation.selected, previous.previousSelection) ||
          activation.rollbackTargetActivationId !== previous.previousActivationId)) ||
      (current && activation.action === "activate_candidate" &&
        (!sameSearchEngineSelection(activation.fallbackSelection, previous.selected) ||
          activation.fallbackActivationId !== previous.activationId)) ||
      (current && activation.action === "refresh_candidate" &&
        (previous.selected.mode !== "candidate" || activation.selected.mode !== "candidate" ||
          previous.selected.candidateId !== activation.selected.candidateId ||
          !sameSearchEngine(previous.selected.engine, activation.selected.engine))) ||
      (current && activation.action === "rollback" && (() => {
        const previousFallback = previous.schemaVersion !== 1
          ? { selection: previous.fallbackSelection, activationId: previous.fallbackActivationId }
          : { selection: previous.previousSelection, activationId: previous.previousActivationId };
        return !sameSearchEngineSelection(activation.selected, previousFallback.selection) ||
          !sameSearchEngineSelection(activation.fallbackSelection, previous.selected) ||
          activation.fallbackActivationId !== previous.activationId;
      })())
    );
    if (invalidRoot || invalidContinuation) {
      throw new SearchError("invalid_engine_activation", "검색 엔진 활성화 chain이 이전 원본과 다릅니다.");
    }
  }
  const { schemaVersion: _schema, activationId: _id, ...core } = activation;
  if (contentId("seact", core) !== activation.activationId) {
    throw new SearchError("invalid_engine_activation", "검색 엔진 활성화 ID가 실제 내용과 다릅니다.");
  }
}
