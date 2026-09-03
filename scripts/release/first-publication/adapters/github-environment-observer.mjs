import { defaultGitHubCliExecute, getGitHubApiJson } from "./github-read-only-api.mjs";
import {
  trustedPublisherEnvironment,
  validateReadinessRepository,
} from "../../lib/trusted-publisher-readiness.mjs";

function unavailable(reason) {
  return {
    schemaVersion: 1,
    source: "github_environment",
    state: "unavailable",
    reason,
  };
}

export async function observeGitHubPublisherEnvironment({
  repository,
  execute = defaultGitHubCliExecute,
  environment = process.env,
} = {}) {
  validateReadinessRepository(repository);
  const root = `repos/${repository}/environments/${trustedPublisherEnvironment}`;
  let environmentResponse;
  try {
    environmentResponse = await getGitHubApiJson(execute, root, environment);
  } catch {
    return unavailable("authentication_or_environment_unavailable");
  }
  if (
    environmentResponse?.name !== trustedPublisherEnvironment ||
    !Array.isArray(environmentResponse.protection_rules) ||
    environmentResponse.deployment_branch_policy?.custom_branch_policies !== true
  )
    return unavailable("response_invalid");
  let policyResponse;
  try {
    policyResponse = await getGitHubApiJson(
      execute,
      `${root}/deployment-branch-policies?per_page=100&page=1`,
      environment,
    );
  } catch {
    return unavailable("branch_policy_unavailable");
  }
  if (
    !Number.isSafeInteger(policyResponse?.total_count) ||
    policyResponse.total_count > 100 ||
    !Array.isArray(policyResponse.branch_policies) ||
    policyResponse.branch_policies.length !== policyResponse.total_count
  )
    return unavailable("response_invalid");
  const reviewerRules = environmentResponse.protection_rules.filter(
    ({ type }) => type === "required_reviewers",
  );
  const requiredReviewerCount = reviewerRules.reduce(
    (count, rule) => count + (Array.isArray(rule.reviewers) ? rule.reviewers.length : 0),
    0,
  );
  return {
    schemaVersion: 1,
    source: "github_environment",
    state: "observed",
    repository,
    environment: trustedPublisherEnvironment,
    requiredReviewerCount,
    preventSelfReview:
      reviewerRules.length > 0 &&
      reviewerRules.every(({ prevent_self_review: value }) => value === true),
    tagPolicies: policyResponse.branch_policies
      .filter(({ type }) => type === "tag")
      .map(({ name }) => name)
      .sort(),
  };
}
