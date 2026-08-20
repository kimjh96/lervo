import {
  assertSearchEngineActivationEvidence,
  assertSearchEngineActivationOperator,
} from "./engine-activation-eligibility.js";
import type {
  SearchEngineActivation,
  SearchEngineActivationPolicy,
  SearchEngineCandidateActivation,
  SearchEngineCandidateRefresh,
  SearchEngineRollback,
} from "./engine-activation-types.js";
import { assertSearchEngineActivation } from "./engine-activation-validation.js";
import {
  baselineSearchEngineSelection,
  candidateSearchEngineSelection,
  sameSearchEngineSelection,
} from "./engine-selection.js";
import type { SearchEvaluationComparison } from "./evaluation-comparison-types.js";
import type { SearchCandidateReview } from "./evaluation-review-types.js";
import { contentId } from "./integrity.js";
import { sameSearchEngine } from "./evaluation-engine.js";
import { SearchError } from "./types.js";

function createTransition<T extends SearchEngineCandidateActivation | SearchEngineCandidateRefresh | SearchEngineRollback>(
  core: Omit<T, "schemaVersion" | "activationId">,
): T {
  const activation = {
    schemaVersion: 2,
    activationId: contentId("seact", core),
    ...core,
  } as T;
  assertSearchEngineActivation(activation);
  return activation;
}

export function searchEngineActivationFallback(
  activation: SearchEngineActivation,
): { selection: SearchEngineActivation["selected"]; activationId: string | null } {
  return activation.schemaVersion === 2
    ? { selection: activation.fallbackSelection, activationId: activation.fallbackActivationId }
    : { selection: activation.previousSelection, activationId: activation.previousActivationId };
}

export function createSearchEngineCandidateActivation(input: {
  policy: SearchEngineActivationPolicy;
  review: SearchCandidateReview;
  comparison: SearchEvaluationComparison;
  previous: SearchEngineActivation | null;
  operatorId: string;
  decidedAt: Date;
}): SearchEngineCandidateActivation {
  assertSearchEngineActivationOperator(input.policy, input.operatorId);
  assertSearchEngineActivationEvidence(input);
  if (!Number.isFinite(input.decidedAt.getTime())) {
    throw new SearchError("invalid_engine_activation", "검색 엔진 활성화 시각이 유효하지 않습니다.");
  }
  if (input.previous !== null) {
    assertSearchEngineActivation(input.previous);
    if (input.previous.projectId !== input.policy.projectId) {
      throw new SearchError("invalid_engine_activation", "이전 검색 엔진 선택의 project가 정책과 다릅니다.");
    }
  }
  const previousSelection = input.previous?.selected ?? baselineSearchEngineSelection();
  const selected = candidateSearchEngineSelection(input.review);
  if (previousSelection.mode === "candidate" && previousSelection.candidateId === selected.candidateId &&
    sameSearchEngine(previousSelection.engine, selected.engine)) {
    throw new SearchError("engine_activation_not_eligible", "같은 후보 엔진의 새 증거는 refresh로 기록해야 합니다.");
  }
  if (sameSearchEngineSelection(previousSelection, selected)) {
    throw new SearchError("engine_activation_not_eligible", "현재 선택과 같은 검색 엔진은 다시 활성화하지 않습니다.");
  }
  return createTransition({
    projectId: input.policy.projectId,
    sequence: (input.previous?.sequence ?? 0) + 1,
    previousActivationId: input.previous?.activationId ?? null,
    action: "activate_candidate",
    policyId: input.policy.policyId,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt.toISOString(),
    previousSelection: structuredClone(previousSelection),
    selected,
    rollbackOfActivationId: null,
    fallbackSelection: structuredClone(previousSelection),
    fallbackActivationId: input.previous?.activationId ?? null,
    recordState: "selection_recorded",
    embeddingDecision: "not_determined",
  });
}

export function createSearchEngineCandidateRefresh(input: {
  policy: SearchEngineActivationPolicy;
  review: SearchCandidateReview;
  comparison: SearchEvaluationComparison;
  previous: SearchEngineActivation;
  operatorId: string;
  decidedAt: Date;
}): SearchEngineCandidateRefresh {
  assertSearchEngineActivationOperator(input.policy, input.operatorId);
  assertSearchEngineActivationEvidence(input);
  assertSearchEngineActivation(input.previous);
  if (input.previous.projectId !== input.policy.projectId || !Number.isFinite(input.decidedAt.getTime())) {
    throw new SearchError("invalid_engine_activation", "검색 엔진 refresh 좌표가 유효하지 않습니다.");
  }
  const previousSelection = input.previous.selected;
  const selected = candidateSearchEngineSelection(input.review);
  if (previousSelection.mode !== "candidate" || previousSelection.candidateId !== selected.candidateId ||
    !sameSearchEngine(previousSelection.engine, selected.engine)) {
    throw new SearchError("engine_activation_not_eligible", "Refresh는 현재 선택과 같은 후보 엔진의 새 증거가 필요합니다.");
  }
  if (sameSearchEngineSelection(previousSelection, selected)) {
    throw new SearchError("engine_activation_not_eligible", "현재 선택과 같은 검토·비교 원본은 refresh하지 않습니다.");
  }
  return createTransition<SearchEngineCandidateRefresh>({
    projectId: input.policy.projectId,
    sequence: input.previous.sequence + 1,
    previousActivationId: input.previous.activationId,
    action: "refresh_candidate",
    policyId: input.policy.policyId,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt.toISOString(),
    previousSelection: structuredClone(previousSelection),
    selected,
    rollbackOfActivationId: null,
    fallbackSelection: baselineSearchEngineSelection(),
    fallbackActivationId: null,
    recordState: "selection_recorded",
    embeddingDecision: "not_determined",
  });
}

export function createSearchEngineRollback(input: {
  policy: SearchEngineActivationPolicy;
  previous: SearchEngineActivation;
  targetReview?: SearchCandidateReview;
  targetComparison?: SearchEvaluationComparison;
  operatorId: string;
  decidedAt: Date;
}): SearchEngineRollback {
  assertSearchEngineActivationOperator(input.policy, input.operatorId);
  assertSearchEngineActivation(input.previous);
  if (input.previous.projectId !== input.policy.projectId || !Number.isFinite(input.decidedAt.getTime())) {
    throw new SearchError("invalid_engine_activation", "검색 엔진 rollback 좌표가 유효하지 않습니다.");
  }
  const fallback = searchEngineActivationFallback(input.previous);
  const selected = fallback.selection;
  if (selected.mode === "candidate") {
    if (input.targetReview === undefined || input.targetComparison === undefined) {
      throw new SearchError("engine_activation_not_eligible", "이전 후보로 돌아가려면 원래 검토·비교 원본이 필요합니다.");
    }
    assertSearchEngineActivationEvidence({
      policy: input.policy,
      review: input.targetReview,
      comparison: input.targetComparison,
    });
    if (!sameSearchEngineSelection(selected, candidateSearchEngineSelection(input.targetReview))) {
      throw new SearchError("engine_activation_not_eligible", "Rollback 대상이 이전 검색 엔진 선택과 다릅니다.");
    }
  } else if (input.targetReview !== undefined || input.targetComparison !== undefined) {
    throw new SearchError("invalid_engine_activation", "Baseline rollback에는 후보 검토 원본을 사용하지 않습니다.");
  }
  return createTransition({
    projectId: input.policy.projectId,
    sequence: input.previous.sequence + 1,
    previousActivationId: input.previous.activationId,
    action: "rollback",
    policyId: input.policy.policyId,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt.toISOString(),
    previousSelection: structuredClone(input.previous.selected),
    selected: structuredClone(selected),
    rollbackOfActivationId: input.previous.activationId,
    fallbackSelection: structuredClone(input.previous.selected),
    fallbackActivationId: input.previous.activationId,
    recordState: "selection_recorded",
    embeddingDecision: "not_determined",
  });
}
