import {
  verifySearchRolloutActionPolicySources,
  type SearchCandidateEngineResolver,
  type SearchEngineActivationPolicy,
  type SearchRolloutReviewPolicy,
} from "@lervo/search";
import {
  inspectOperationalSearchEngine,
  loadSearchEngineActivationPolicies,
  loadSearchRolloutActionPolicies,
  loadSearchRolloutReviewPolicies,
  readLocalSearchRolloutActionStatus,
  readLocalSearchRolloutStatus,
} from "@lervo/search-local";
import type { DoctorInspection } from "@lervo/diagnostics";

import { doctorInspection, doctorIssue } from "./doctor-inspection-result.js";

function invalidInspection(
  checkId: DoctorInspection["check"]["checkId"],
  code: Parameters<typeof doctorIssue>[0],
  message: string,
  observedCount = 0,
): DoctorInspection {
  return doctorInspection(checkId, "unhealthy", observedCount, [doctorIssue(code, message)]);
}

async function inspectSearchPolicies(input: {
  repositoryRoot: string;
  projectId: string;
}): Promise<DoctorInspection> {
  try {
    const [enginePolicies, rolloutPolicies, actionPolicies] = await Promise.all([
      loadSearchEngineActivationPolicies(input.repositoryRoot),
      loadSearchRolloutReviewPolicies(input.repositoryRoot),
      loadSearchRolloutActionPolicies(input.repositoryRoot),
    ]);
    const engineById = new Map<string, SearchEngineActivationPolicy>(
      enginePolicies.map((policy) => [policy.policyId, policy]),
    );
    const rolloutById = new Map<string, SearchRolloutReviewPolicy>(
      rolloutPolicies.map((policy) => [policy.policyId, policy]),
    );
    if ([...enginePolicies, ...rolloutPolicies, ...actionPolicies].some(
      (policy) => policy.projectId !== input.projectId,
    )) {
      throw new TypeError("검색 정책의 project 좌표가 다릅니다.");
    }
    for (const policy of actionPolicies) {
      const rolloutPolicy = rolloutById.get(policy.rolloutPolicyId);
      const engineActivationPolicy = policy.engineActivationPolicyId === null
        ? undefined
        : engineById.get(policy.engineActivationPolicyId);
      if (rolloutPolicy === undefined) throw new TypeError("Rollout 검토 정책 원본이 없습니다.");
      verifySearchRolloutActionPolicySources(policy, {
        rolloutPolicy,
        ...(engineActivationPolicy === undefined ? {} : { engineActivationPolicy }),
      });
    }
    return doctorInspection(
      "search_rollout_policies",
      "healthy",
      enginePolicies.length + rolloutPolicies.length + actionPolicies.length,
    );
  } catch {
    return invalidInspection(
      "search_rollout_policies",
      "search_rollout_policy_invalid",
      "검색 엔진·rollout 정책 원본을 안전하게 검증하지 못했습니다.",
    );
  }
}

async function inspectSearchSelection(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchCandidateEngineResolver;
}): Promise<DoctorInspection> {
  try {
    const result = await inspectOperationalSearchEngine(input);
    return result.resolverState === "ready"
      ? doctorInspection("search_engine_selection", "healthy", result.transitions)
      : invalidInspection(
        "search_engine_selection",
        "search_engine_selection_invalid",
        "현재 검색 엔진 선택과 근거를 안전하게 검증하지 못했습니다.",
        result.transitions,
      );
  } catch {
    return invalidInspection(
      "search_engine_selection",
      "search_engine_selection_invalid",
      "현재 검색 엔진 선택과 근거를 안전하게 검증하지 못했습니다.",
    );
  }
}

function unavailableInspection(
  checkId: "search_rollout_reviews" | "search_rollout_actions",
  code: "search_rollout_review_unavailable" | "search_rollout_action_unavailable",
  message: string,
): DoctorInspection {
  return doctorInspection(checkId, "unknown", 0, [doctorIssue(code, message)]);
}

export async function inspectDoctorSearch(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchCandidateEngineResolver;
  observedAt: Date;
}): Promise<DoctorInspection[]> {
  const [selection, policies] = await Promise.all([
    inspectSearchSelection(input),
    inspectSearchPolicies(input),
  ]);
  if (selection.check.status !== "healthy" || policies.check.status !== "healthy") {
    return [
      selection,
      policies,
      unavailableInspection(
        "search_rollout_reviews",
        "search_rollout_review_unavailable",
        "검색 선택이나 정책 문제로 rollout 검토를 판정할 수 없습니다.",
      ),
      unavailableInspection(
        "search_rollout_actions",
        "search_rollout_action_unavailable",
        "검색 선택이나 정책 문제로 rollout 조치를 판정할 수 없습니다.",
      ),
    ];
  }
  let reviews: DoctorInspection;
  try {
    const status = await readLocalSearchRolloutStatus(input);
    reviews = doctorInspection("search_rollout_reviews", "healthy", status.reviewCount);
  } catch {
    reviews = invalidInspection(
      "search_rollout_reviews",
      "search_rollout_review_invalid",
      "검색 rollout 검토와 품질 근거를 안전하게 검증하지 못했습니다.",
    );
  }
  if (reviews.check.status !== "healthy") {
    return [
      selection,
      policies,
      reviews,
      unavailableInspection(
        "search_rollout_actions",
        "search_rollout_action_unavailable",
        "Rollout 검토 문제로 조치 원본을 판정할 수 없습니다.",
      ),
    ];
  }
  let actions: DoctorInspection;
  try {
    const status = await readLocalSearchRolloutActionStatus(input);
    actions = doctorInspection("search_rollout_actions", "healthy", status.actionCount);
  } catch {
    actions = invalidInspection(
      "search_rollout_actions",
      "search_rollout_action_invalid",
      "검색 rollout 조치와 연결 근거를 안전하게 검증하지 못했습니다.",
    );
  }
  return [selection, policies, reviews, actions];
}
