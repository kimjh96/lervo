import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { validateFirstPublicationExecutionReceipt } from
  "./first-publication-execution-receipt.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

export const stageOnlyPublicationCommand =
  "pnpm release:publication:stage --release-directory \"${RUNNER_TEMP}/lervo-release\" " +
  "--publication-authorization \"${RUNNER_TEMP}/lervo-publication-authorization.json\"";
export const stageOnlyRunCommands = [
  "pnpm install --frozen-lockfile",
  stageOnlyPublicationCommand,
];

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_transition_input_invalid",
    "CLI 최초 게시 전환 입력이 올바르지 않습니다.",
  );
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
}

function strings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, output));
  else if (value !== null && typeof value === "object") {
    Object.values(value).forEach((item) => strings(item, output));
  }
  return output;
}

function check(id, reasons) {
  return { id, status: reasons.length === 0 ? "ready" : "blocked", reasons };
}

function inspectWorkflow(workflow) {
  const reasons = [];
  const job = workflow?.jobs?.["publish-cli"];
  if (job === null || typeof job !== "object" || Array.isArray(job)) {
    return check("stage_only_workflow", ["stage_job_missing"]);
  }
  if (job.if !== "github.event_name == 'workflow_dispatch' && github.ref_type == 'tag'") {
    reasons.push("stage_job_trigger_invalid");
  }
  if (job.needs !== "attested-cli") reasons.push("stage_job_attestation_dependency_invalid");
  if (job["runs-on"] !== "ubuntu-latest") reasons.push("stage_job_runner_invalid");
  if (job.environment !== "npm-release") reasons.push("stage_job_environment_invalid");
  if (canonicalJson(job.permissions) !== canonicalJson({
    contents: "read",
    "id-token": "write",
  })) reasons.push("stage_job_permissions_invalid");
  if (!Array.isArray(job.steps)) reasons.push("stage_job_steps_invalid");
  const runs = Array.isArray(job.steps)
    ? job.steps.map(({ run }) => run).filter((run) => typeof run === "string")
    : [];
  if (canonicalJson(runs) !== canonicalJson(stageOnlyRunCommands)) {
    reasons.push("stage_command_invalid");
  }
  const jobStrings = strings(job);
  if (jobStrings.some((value) =>
    /(?:^|\s)npm\s+(?:publish|stage\s+publish)(?:\s|$)|release:publication:publish/u.test(value)
  )) reasons.push("direct_publish_command_present");
  const environments = [
    job.env,
    ...(Array.isArray(job.steps) ? job.steps.map(({ env }) => env) : []),
  ]
    .filter((value) => value !== undefined);
  if (environments.some((environment) =>
    environment === null || typeof environment !== "object" || Array.isArray(environment) ||
    Object.keys(environment).some((name) =>
      ["npm_token", "node_auth_token"].includes(name.toLowerCase()) ||
      (name.toLowerCase().startsWith("npm_config_") &&
        name.toLowerCase().includes("auth"))
    )
  )) reasons.push("registry_write_credential_present");
  return check("stage_only_workflow", [...new Set(reasons)]);
}

function inspectNpm(observation, repository) {
  const reasons = [];
  if (
    observation?.schemaVersion !== 1 || observation.source !== "npm_trust" ||
    observation.state !== "configured" || observation.package !== "@lervo/cli"
  ) return check("npm_trusted_publisher", ["npm_trusted_publisher_not_observed"]);
  if (observation.provider !== "github") reasons.push("npm_publisher_provider_mismatch");
  if (observation.repository !== repository) reasons.push("npm_publisher_repository_mismatch");
  if (observation.workflow !== "cli-release-matrix.yml") {
    reasons.push("npm_publisher_workflow_mismatch");
  }
  if (observation.environment !== "npm-release") {
    reasons.push("npm_publisher_environment_mismatch");
  }
  if (canonicalJson(observation.permissions) !== canonicalJson(["createStagedPackage"])) {
    reasons.push("npm_publisher_permission_mismatch");
  }
  return check("npm_trusted_publisher", reasons);
}

function inspectGitHub(observation, repository) {
  const reasons = [];
  if (
    observation?.schemaVersion !== 1 || observation.source !== "github_environment" ||
    observation.state !== "observed" || observation.repository !== repository ||
    observation.environment !== "npm-release"
  ) return check("github_environment", ["github_environment_not_observed"]);
  if (!Number.isSafeInteger(observation.requiredReviewerCount) ||
      observation.requiredReviewerCount < 1) {
    reasons.push("github_required_reviewer_missing");
  }
  if (observation.preventSelfReview !== true) reasons.push("github_self_review_allowed");
  if (canonicalJson(observation.tagPolicies) !== canonicalJson(["v*"])) {
    reasons.push("github_release_tag_policy_mismatch");
  }
  return check("github_environment", reasons);
}

export function createFirstPublicationTransitionReport({
  bootstrap,
  armingAuthorization,
  publicationAuthorization,
  executionReceipt,
  workflow,
  npmObservation,
  githubObservation,
  observedAt,
}) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  validateFirstPublicationExecutionReceipt(executionReceipt, {
    bootstrap,
    armingAuthorization,
    publicationAuthorization,
  });
  if (workflow === null || typeof workflow !== "object" || Array.isArray(workflow)) fail();
  if (timestamp(observedAt) < timestamp(executionReceipt.publication.publishedAt)) fail();
  const checks = [
    inspectWorkflow(workflow),
    inspectNpm(npmObservation, bootstrap.identity.repository),
    inspectGitHub(githubObservation, bootstrap.identity.repository),
  ];
  const body = {
    schemaVersion: 1,
    status: checks.every(({ status }) => status === "ready") ? "ready" : "blocked",
    bootstrapDigest: bootstrap.bootstrapDigest,
    executionReceiptDigest: executionReceipt.executionReceiptDigest,
    observedAt,
    checks,
  };
  return { ...body, transitionReportDigest: canonicalDigest(body) };
}
