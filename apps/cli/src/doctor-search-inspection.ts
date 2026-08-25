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
    if (
      [...enginePolicies, ...rolloutPolicies, ...actionPolicies].some(
        (policy) => policy.projectId !== input.projectId,
      )
    ) {
      throw new TypeError("The search policy project coordinate does not match.");
    }
    for (const policy of actionPolicies) {
      const rolloutPolicy = rolloutById.get(policy.rolloutPolicyId);
      const engineActivationPolicy =
        policy.engineActivationPolicyId === null
          ? undefined
          : engineById.get(policy.engineActivationPolicyId);
      if (rolloutPolicy === undefined)
        throw new TypeError("The rollout review policy source is missing.");
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
      "Could not safely validate search engine and rollout policy sources.",
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
          "Could not safely validate the current search engine selection and evidence.",
          result.transitions,
        );
  } catch {
    return invalidInspection(
      "search_engine_selection",
      "search_engine_selection_invalid",
      "Could not safely validate the current search engine selection and evidence.",
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
        "Could not assess rollout reviews because of a search selection or policy issue.",
      ),
      unavailableInspection(
        "search_rollout_actions",
        "search_rollout_action_unavailable",
        "Could not assess rollout actions because of a search selection or policy issue.",
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
      "Could not safely validate search rollout reviews and quality evidence.",
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
        "Could not assess action sources because of a rollout review issue.",
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
      "Could not safely validate search rollout actions and linked evidence.",
    );
  }
  return [selection, policies, reviews, actions];
}
