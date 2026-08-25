import { SEARCH_CANDIDATE_ID_PATTERN } from "./evaluation-engine-registry.js";
import type { SearchEngineActivationPolicy } from "./engine-activation-types.js";
import { contentId } from "./integrity.js";
import { SearchError } from "./types.js";
import { assertTimestamp, SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_ENGINE_ACTIVATION_POLICY_PATTERN = /^sepol_[a-f0-9]{24}$/;

function orderedUnique(values: readonly string[], pattern: RegExp, maximum: number): string[] {
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > maximum ||
    values.some((value) => typeof value !== "string" || !pattern.test(value))
  ) {
    throw new SearchError(
      "invalid_engine_activation_policy",
      "The search engine activation policy allowlist is invalid.",
    );
  }
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new SearchError(
      "invalid_engine_activation_policy",
      "The search engine activation policy allowlist contains duplicates.",
    );
  }
  return sorted;
}

export function createSearchEngineActivationPolicy(input: {
  projectId: string;
  allowedReviewerIds: readonly string[];
  allowedOperatorIds: readonly string[];
  allowedCandidateIds: readonly string[];
  minimumCandidateWins: number;
  authoredBy: string;
  createdAt: Date;
}): SearchEngineActivationPolicy {
  if (
    !SOURCE_ID_PATTERN.test(input.projectId) ||
    !SOURCE_ID_PATTERN.test(input.authoredBy) ||
    !Number.isSafeInteger(input.minimumCandidateWins) ||
    input.minimumCandidateWins < 1 ||
    input.minimumCandidateWins > 64 ||
    !Number.isFinite(input.createdAt.getTime())
  ) {
    throw new SearchError(
      "invalid_engine_activation_policy",
      "The search engine activation policy input is invalid.",
    );
  }
  const core = {
    projectId: input.projectId,
    allowedReviewerIds: orderedUnique(input.allowedReviewerIds, SOURCE_ID_PATTERN, 32),
    allowedOperatorIds: orderedUnique(input.allowedOperatorIds, SOURCE_ID_PATTERN, 32),
    allowedCandidateIds: orderedUnique(input.allowedCandidateIds, SEARCH_CANDIDATE_ID_PATTERN, 16),
    minimumCandidateWins: input.minimumCandidateWins,
    maximumBaselineWins: 0 as const,
    authoredBy: input.authoredBy,
    createdAt: input.createdAt.toISOString(),
  };
  if (!core.allowedOperatorIds.includes(input.authoredBy)) {
    throw new SearchError(
      "invalid_engine_activation_policy",
      "The policy author must be included in the allowed operators.",
    );
  }
  const policy: SearchEngineActivationPolicy = {
    schemaVersion: 1,
    policyId: contentId("sepol", core),
    ...core,
  };
  assertSearchEngineActivationPolicy(policy);
  return policy;
}

export function assertSearchEngineActivationPolicy(policy: SearchEngineActivationPolicy): void {
  if (
    policy.schemaVersion !== 1 ||
    !SEARCH_ENGINE_ACTIVATION_POLICY_PATTERN.test(policy.policyId) ||
    !SOURCE_ID_PATTERN.test(policy.projectId) ||
    !SOURCE_ID_PATTERN.test(policy.authoredBy) ||
    !Number.isSafeInteger(policy.minimumCandidateWins) ||
    policy.minimumCandidateWins < 1 ||
    policy.minimumCandidateWins > 64 ||
    policy.maximumBaselineWins !== 0
  ) {
    throw new SearchError(
      "invalid_engine_activation_policy",
      "The search engine activation policy contract is invalid.",
    );
  }
  const reviewers = orderedUnique(policy.allowedReviewerIds, SOURCE_ID_PATTERN, 32);
  const operators = orderedUnique(policy.allowedOperatorIds, SOURCE_ID_PATTERN, 32);
  const candidates = orderedUnique(policy.allowedCandidateIds, SEARCH_CANDIDATE_ID_PATTERN, 16);
  if (
    JSON.stringify(reviewers) !== JSON.stringify(policy.allowedReviewerIds) ||
    JSON.stringify(operators) !== JSON.stringify(policy.allowedOperatorIds) ||
    JSON.stringify(candidates) !== JSON.stringify(policy.allowedCandidateIds) ||
    !operators.includes(policy.authoredBy)
  ) {
    throw new SearchError(
      "invalid_engine_activation_policy",
      "Ordering or author coordinates in the search engine activation policy are invalid.",
    );
  }
  assertTimestamp(policy.createdAt, "invalid_engine_activation_policy");
  const { schemaVersion: _schema, policyId: _id, ...core } = policy;
  if (contentId("sepol", core) !== policy.policyId) {
    throw new SearchError(
      "invalid_engine_activation_policy",
      "The search engine activation policy ID does not match its content.",
    );
  }
}
