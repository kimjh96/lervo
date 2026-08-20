import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  trustedPublisherEnvironment,
  validateReadinessRepository,
} from "./trusted-publisher-readiness.mjs";

const execFileAsync = promisify(execFile);

function unavailable(reason) {
  return {
    schemaVersion: 1,
    source: "github_environment",
    state: "unavailable",
    reason,
  };
}

async function getJson(execute, path, environment) {
  const { stdout } = await execute("gh", [
    "api",
    "--method",
    "GET",
    "--header",
    "Accept: application/vnd.github+json",
    "--header",
    "X-GitHub-Api-Version: 2026-03-10",
    path,
  ], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: 30_000,
    env: {
      ...environment,
      GH_PAGER: "cat",
      GH_PROMPT_DISABLED: "1",
      NO_COLOR: "1",
    },
  });
  return JSON.parse(stdout);
}

export async function observeGitHubPublisherEnvironment({
  repository,
  execute = execFileAsync,
  environment = process.env,
} = {}) {
  validateReadinessRepository(repository);
  const root = `repos/${repository}/environments/${trustedPublisherEnvironment}`;
  let environmentResponse;
  try {
    environmentResponse = await getJson(execute, root, environment);
  } catch {
    return unavailable("authentication_or_environment_unavailable");
  }
  if (
    environmentResponse?.name !== trustedPublisherEnvironment ||
    !Array.isArray(environmentResponse.protection_rules) ||
    environmentResponse.deployment_branch_policy?.custom_branch_policies !== true
  ) return unavailable("response_invalid");
  let policyResponse;
  try {
    policyResponse = await getJson(
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
  ) return unavailable("response_invalid");
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
    preventSelfReview: reviewerRules.length > 0 &&
      reviewerRules.every(({ prevent_self_review: value }) => value === true),
    tagPolicies: policyResponse.branch_policies
      .filter(({ type }) => type === "tag")
      .map(({ name }) => name)
      .sort(),
  };
}
