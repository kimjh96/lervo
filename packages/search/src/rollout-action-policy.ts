import {
  assertSearchEngineActivationPolicy,
} from "./engine-activation-policy.js";
import { SEARCH_ENGINE_ACTIVATION_POLICY_PATTERN } from "./engine-activation-policy.js";
import { contentId } from "./integrity.js";
import { assertSearchRolloutReviewPolicy } from "./rollout-policy.js";
import { SEARCH_ROLLOUT_POLICY_PATTERN } from "./rollout-policy-types.js";
import {
  SEARCH_ROLLOUT_ACTION_POLICY_PATTERN,
  searchRolloutActionKinds,
  type SearchRolloutActionKind,
  type SearchRolloutActionPolicy,
  type SearchRolloutActionPolicySources,
} from "./rollout-action-types.js";
import { SearchError } from "./types.js";
import { assertTimestamp, SOURCE_ID_PATTERN } from "./validation.js";

function orderedOperators(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 32 ||
    values.some((value) => typeof value !== "string" || !SOURCE_ID_PATTERN.test(value))) {
    throw new SearchError("invalid_rollout_action_policy", "검색 rollout 조치 정책의 operator 목록이 유효하지 않습니다.");
  }
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new SearchError("invalid_rollout_action_policy", "검색 rollout 조치 정책의 operator 목록이 중복되었습니다.");
  }
  return sorted;
}

export function createSearchRolloutActionPolicy(input: SearchRolloutActionPolicySources & {
  action: SearchRolloutActionKind;
  allowedOperatorIds: readonly string[];
  authoredBy: string;
  createdAt: Date;
}): SearchRolloutActionPolicy {
  const { rolloutPolicy, engineActivationPolicy } = input;
  assertSearchRolloutReviewPolicy(rolloutPolicy);
  if (engineActivationPolicy !== undefined) assertSearchEngineActivationPolicy(engineActivationPolicy);
  const isRollback = input.action === "execute_rollback";
  if (!searchRolloutActionKinds.includes(input.action) || !SOURCE_ID_PATTERN.test(input.authoredBy) ||
    !Number.isFinite(input.createdAt.getTime()) || isRollback !== (engineActivationPolicy !== undefined) ||
    input.createdAt.getTime() < Date.parse(rolloutPolicy.createdAt) ||
    (engineActivationPolicy !== undefined && (
      rolloutPolicy.projectId !== engineActivationPolicy.projectId ||
      input.createdAt.getTime() < Date.parse(engineActivationPolicy.createdAt)
    ))) {
    throw new SearchError("invalid_rollout_action_policy", "검색 rollout 조치 정책 입력과 원본 관계가 유효하지 않습니다.");
  }
  const operators = orderedOperators(input.allowedOperatorIds);
  if (!operators.includes(input.authoredBy) ||
    (engineActivationPolicy !== undefined &&
      operators.some((operatorId) => !engineActivationPolicy.allowedOperatorIds.includes(operatorId)))) {
    throw new SearchError("invalid_rollout_action_policy", "조치 정책의 작성자·operator 범위가 유효하지 않습니다.");
  }
  const core = {
    projectId: rolloutPolicy.projectId,
    rolloutPolicyId: rolloutPolicy.policyId,
    action: input.action,
    allowedOperatorIds: operators,
    engineActivationPolicyId: engineActivationPolicy?.policyId ?? null,
    authoredBy: input.authoredBy,
    createdAt: input.createdAt.toISOString(),
  };
  const policy: SearchRolloutActionPolicy = {
    schemaVersion: 1,
    actionPolicyId: contentId("srapol", core),
    ...core,
  };
  assertSearchRolloutActionPolicy(policy);
  return policy;
}

export function assertSearchRolloutActionPolicy(policy: SearchRolloutActionPolicy): void {
  if (policy.schemaVersion !== 1 || !SEARCH_ROLLOUT_ACTION_POLICY_PATTERN.test(policy.actionPolicyId) ||
    !SOURCE_ID_PATTERN.test(policy.projectId) || !SEARCH_ROLLOUT_POLICY_PATTERN.test(policy.rolloutPolicyId) ||
    !searchRolloutActionKinds.includes(policy.action) || !SOURCE_ID_PATTERN.test(policy.authoredBy) ||
    ((policy.action === "execute_rollback") !== (policy.engineActivationPolicyId !== null)) ||
    (policy.engineActivationPolicyId !== null &&
      !SEARCH_ENGINE_ACTIVATION_POLICY_PATTERN.test(policy.engineActivationPolicyId))) {
    throw new SearchError("invalid_rollout_action_policy", "검색 rollout 조치 정책 계약이 유효하지 않습니다.");
  }
  const operators = orderedOperators(policy.allowedOperatorIds);
  if (JSON.stringify(operators) !== JSON.stringify(policy.allowedOperatorIds) ||
    !operators.includes(policy.authoredBy)) {
    throw new SearchError("invalid_rollout_action_policy", "조치 정책의 정렬·작성자 좌표가 유효하지 않습니다.");
  }
  assertTimestamp(policy.createdAt, "invalid_rollout_action_policy");
  const { schemaVersion: _schema, actionPolicyId: _id, ...core } = policy;
  if (contentId("srapol", core) !== policy.actionPolicyId) {
    throw new SearchError("invalid_rollout_action_policy", "검색 rollout 조치 정책 ID가 실제 내용과 다릅니다.");
  }
}
