import { canonicalDigest } from "./release-artifact-manifest.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";

const repositoryPattern = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/u;

export const trustedPublisherEnvironment = "npm-release";
export const trustedPublisherWorkflow = "cli-release-matrix.yml";

export class TrustedPublisherReadinessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TrustedPublisherReadinessError";
    this.code = code;
  }
}

function fail() {
  throw new TrustedPublisherReadinessError(
    "trusted_publisher_readiness_input_invalid",
    "Trusted Publisher 준비 상태 입력이 올바르지 않습니다.",
  );
}

export function validateReadinessRepository(repository) {
  if (
    typeof repository !== "string" ||
    !repositoryPattern.test(repository) ||
    repository.includes("..")
  ) fail();
  return repository;
}

function check(id, reasons, details = {}) {
  return {
    id,
    status: reasons.length === 0 ? "ready" : "blocked",
    reasons,
    ...details,
  };
}

function unknownCheck(id, reason) {
  return { id, status: "unknown", reasons: [reason] };
}

function inspectPackage(manifest, repository) {
  const reasons = [];
  if (
    manifest?.name !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(manifest?.version ?? "") ||
    manifest.private !== false ||
    manifest.publishConfig?.access !== "public"
  ) reasons.push("package_identity_invalid");
  const expectedRepository = `git+https://github.com/${repository}.git`;
  if (manifest?.repository === undefined) {
    reasons.push("package_repository_missing");
  } else if (
    manifest.repository?.type !== "git" ||
    manifest.repository.url !== expectedRepository
  ) {
    reasons.push("package_repository_mismatch");
  }
  if (typeof manifest?.license !== "string" || manifest.license === "UNLICENSED") {
    reasons.push("package_license_unresolved");
  }
  if (manifest?.publishConfig?.registry !== npmPublicRegistry) {
    reasons.push("package_registry_unpinned");
  }
  if (manifest?.publishConfig?.provenance === false) reasons.push("package_provenance_disabled");
  return check("package_identity", reasons, { expectedRepository });
}

function workflowStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => workflowStrings(item, output));
  else if (value !== null && typeof value === "object") {
    Object.values(value).forEach((item) => workflowStrings(item, output));
  }
  return output;
}

function inspectInactiveWorkflow(workflow) {
  const jobs = workflow?.jobs;
  const strings = workflowStrings(jobs);
  const hasPublishCommand = strings.some((value) =>
    /(?:^|\s)npm\s+(?:publish|stage\s+publish)(?:\s|$)|release:publication:(?:publish|stage)/u.test(value)
  );
  const hasPublishEnvironment = jobs !== null &&
    typeof jobs === "object" &&
    Object.values(jobs).some((job) =>
      job?.environment === trustedPublisherEnvironment ||
      job?.environment?.name === trustedPublisherEnvironment
    );
  const reasons = [];
  if (jobs === null || typeof jobs !== "object" || Array.isArray(jobs)) {
    reasons.push("release_workflow_invalid");
  }
  if (hasPublishCommand || hasPublishEnvironment || jobs?.["publish-cli"] !== undefined) {
    reasons.push("publish_job_already_active");
  }
  return check("workflow_activation_boundary", reasons, { activationState: "inactive" });
}

function inspectNpmObservation(observation, repository) {
  if (observation === undefined) {
    return [
      unknownCheck("npm_package_access", "npm_observation_missing"),
      unknownCheck("npm_trusted_publisher", "npm_observation_missing"),
    ];
  }
  if (observation?.schemaVersion !== 1 || observation.source !== "npm_trust") fail();
  if (observation.state === "unavailable") {
    return [
      unknownCheck("npm_package_access", "npm_observation_unavailable"),
      unknownCheck("npm_trusted_publisher", "npm_observation_unavailable"),
    ];
  }
  if (observation.package !== "@lervo/cli") fail();
  if (observation.state === "package_missing") {
    return [
      check("npm_package_access", ["npm_package_bootstrap_required"]),
      check("npm_trusted_publisher", ["npm_publisher_requires_existing_package"]),
    ];
  }
  const access = check("npm_package_access", [], { access: "write_confirmed" });
  if (observation.state === "not_configured") {
    return [access, check("npm_trusted_publisher", ["npm_trusted_publisher_missing"])];
  }
  if (observation.state !== "configured") fail();
  const reasons = [];
  if (observation.provider !== "github") reasons.push("npm_publisher_provider_mismatch");
  if (observation.repository !== repository) reasons.push("npm_publisher_repository_mismatch");
  if (observation.workflow !== trustedPublisherWorkflow) {
    reasons.push("npm_publisher_workflow_mismatch");
  }
  if (observation.environment !== trustedPublisherEnvironment) {
    reasons.push("npm_publisher_environment_mismatch");
  }
  if (
    !Array.isArray(observation.permissions) ||
    observation.permissions.length !== 1 ||
    observation.permissions[0] !== "createStagedPackage"
  ) reasons.push("npm_publisher_permission_mismatch");
  return [access, check("npm_trusted_publisher", reasons)];
}

function inspectGitHubObservation(observation, repository) {
  if (observation === undefined) {
    return unknownCheck("github_environment", "github_observation_missing");
  }
  if (observation?.schemaVersion !== 1 || observation.source !== "github_environment") fail();
  if (observation.state === "unavailable") {
    return unknownCheck("github_environment", "github_observation_unavailable");
  }
  if (observation.state === "not_configured") {
    return check("github_environment", ["github_environment_missing"]);
  }
  if (
    observation.state !== "observed" ||
    observation.repository !== repository ||
    observation.environment !== trustedPublisherEnvironment
  ) fail();
  const reasons = [];
  if (!Number.isSafeInteger(observation.requiredReviewerCount) ||
      observation.requiredReviewerCount < 1) {
    reasons.push("github_required_reviewer_missing");
  }
  if (observation.preventSelfReview !== true) reasons.push("github_self_review_allowed");
  if (
    !Array.isArray(observation.tagPolicies) ||
    observation.tagPolicies.length !== 1 ||
    observation.tagPolicies[0] !== "v*"
  ) reasons.push("github_release_tag_policy_mismatch");
  return check("github_environment", reasons);
}

export function createTrustedPublisherReadinessReport({
  repository,
  packageManifest,
  workflow,
  npmObservation,
  githubObservation,
}) {
  validateReadinessRepository(repository);
  if (
    packageManifest === null || typeof packageManifest !== "object" ||
    workflow === null || typeof workflow !== "object"
  ) fail();
  const checks = [
    inspectPackage(packageManifest, repository),
    inspectInactiveWorkflow(workflow),
    ...inspectNpmObservation(npmObservation, repository),
    inspectGitHubObservation(githubObservation, repository),
  ];
  const body = {
    schemaVersion: 1,
    status: checks.every(({ status }) => status === "ready") ? "ready" : "blocked",
    target: {
      registry: npmPublicRegistry,
      package: "@lervo/cli",
      repository,
      workflow: trustedPublisherWorkflow,
      environment: trustedPublisherEnvironment,
    },
    checks,
  };
  return { ...body, readinessDigest: canonicalDigest(body) };
}
