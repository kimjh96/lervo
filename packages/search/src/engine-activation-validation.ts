import type { SearchEngineActivation } from "./engine-activation-types.js";
import { assertSearchEngineSelection, sameSearchEngineSelection } from "./engine-selection.js";
import { contentId } from "./integrity.js";
import { SearchError } from "./types.js";
import { assertTimestamp, SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_ENGINE_ACTIVATION_PATTERN = /^seact_[a-f0-9]{24}$/;

export function assertSearchEngineActivation(
  activation: SearchEngineActivation,
  previous?: SearchEngineActivation | null,
): void {
  const legacy = activation.schemaVersion === 1;
  const current = activation.schemaVersion === 2;
  if ((!legacy && !current) || !SEARCH_ENGINE_ACTIVATION_PATTERN.test(activation.activationId) ||
    !SOURCE_ID_PATTERN.test(activation.projectId) || !Number.isSafeInteger(activation.sequence) ||
    activation.sequence < 1 || (activation.previousActivationId !== null &&
      !SEARCH_ENGINE_ACTIVATION_PATTERN.test(activation.previousActivationId)) ||
    (activation.rollbackOfActivationId !== null &&
      !SEARCH_ENGINE_ACTIVATION_PATTERN.test(activation.rollbackOfActivationId)) ||
    !["activate_candidate", "rollback"].includes(activation.action) ||
    !/^sepol_[a-f0-9]{24}$/.test(activation.policyId) || !SOURCE_ID_PATTERN.test(activation.operatorId) ||
    activation.embeddingDecision !== "not_determined") {
    throw new SearchError("invalid_engine_activation", "검색 엔진 활성화 계약이 유효하지 않습니다.");
  }
  if (legacy) {
    const hasLegacyState = activation.applicationState === "not_connected" && activation.recordState === undefined;
    const hasInterimState = activation.recordState === "selection_recorded" && activation.applicationState === undefined;
    if ((!hasLegacyState && !hasInterimState) ||
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
    (activation.action === "activate_candidate" && (activation.selected.mode !== "candidate" ||
      activation.rollbackOfActivationId !== null)) ||
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
    if (!sameSearchEngineSelection(activation.fallbackSelection, activation.previousSelection) ||
      activation.fallbackActivationId !== activation.previousActivationId ||
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
      (current && activation.action === "rollback" && (() => {
        const previousFallback = previous.schemaVersion === 2
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
