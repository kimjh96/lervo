import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

import { observeGitHubPublisherEnvironment } from "./github-environment-observer.mjs";
import { readJson, repositoryRoot } from "./installed-cli.mjs";
import { observeNpmTrustedPublisher } from "./npm-trust-observer.mjs";
import {
  createTrustedPublisherReadinessReport,
  TrustedPublisherReadinessError,
} from "./trusted-publisher-readiness.mjs";

const packageManifestPath = resolve(repositoryRoot, "apps/cli/package.json");
const workflowPath = resolve(repositoryRoot, ".github/workflows/cli-release-matrix.yml");

export async function checkCliTrustedPublisherReadiness(
  { repository, online = false },
  dependencies = {},
) {
  const observeNpm = dependencies.observeNpmTrustedPublisher ?? observeNpmTrustedPublisher;
  const observeGitHub = dependencies.observeGitHubPublisherEnvironment ??
    observeGitHubPublisherEnvironment;
  let packageManifest;
  let workflow;
  try {
    [packageManifest, workflow] = await Promise.all([
      readJson(packageManifestPath),
      readFile(workflowPath, "utf8").then((contents) => parse(contents)),
    ]);
  } catch {
    throw new TrustedPublisherReadinessError(
      "trusted_publisher_readiness_source_invalid",
      "The Trusted Publisher readiness sources could not be read.",
    );
  }
  const [npmObservation, githubObservation] = online
    ? await Promise.all([
        observeNpm(),
        observeGitHub({ repository }),
      ])
    : [undefined, undefined];
  return createTrustedPublisherReadinessReport({
    repository,
    packageManifest,
    workflow,
    npmObservation,
    githubObservation,
  });
}

const checkLabels = {
  package_identity: "Package identity",
  workflow_activation_boundary: "Inactive publication-job boundary",
  npm_package_access: "npm package write access",
  npm_trusted_publisher: "npm Trusted Publisher",
  github_environment: "GitHub publication environment",
};

const reasonMessages = {
  package_identity_invalid: "The public CLI package identity differs from the current contract.",
  package_repository_missing: "package.json has no GitHub repository URL.",
  package_repository_mismatch: "The package.json repository URL differs from the selected repository.",
  package_license_unresolved: "The license for public distribution is unresolved.",
  package_registry_unpinned: "publishConfig does not pin the public npm registry.",
  package_provenance_disabled: "npm provenance is disabled.",
  release_workflow_invalid: "The CLI release workflow structure is invalid.",
  publish_job_already_active: "The real npm publication job is active before readiness is confirmed.",
  npm_observation_missing: "The online npm check was not run.",
  npm_observation_unavailable: "The npm configuration could not be inspected read-only.",
  npm_public_package_not_visible: "@lervo/cli is not visible in the public npm registry.",
  npm_trust_not_observed: "npm Trusted Publisher was not checked because the public package is not visible.",
  npm_trusted_publisher_missing: "npm Trusted Publisher is not configured.",
  npm_publisher_provider_mismatch: "The npm publisher is not configured for GitHub Actions.",
  npm_publisher_repository_mismatch: "The npm publisher repository differs from the selected repository.",
  npm_publisher_workflow_mismatch: "The npm publisher workflow file differs from the release workflow.",
  npm_publisher_environment_mismatch: "The npm publisher environment differs from npm-release.",
  npm_publisher_permission_mismatch: "The npm publisher permission is not limited to stage publication.",
  github_observation_missing: "The online GitHub environment check was not run.",
  github_observation_unavailable: "The GitHub publication environment could not be inspected read-only.",
  github_environment_missing: "The GitHub npm-release environment is missing.",
  github_required_reviewer_missing: "The npm-release environment has no required reviewer.",
  github_self_review_allowed: "The initiating actor can approve their own publication.",
  github_release_tag_policy_mismatch: "The npm-release environment is not restricted to v* tags.",
};

export function formatTrustedPublisherReadiness(report) {
  const state = report.status === "ready" ? "ready" : "blocked";
  const lines = [`CLI Trusted Publisher readiness: ${state}`];
  for (const item of report.checks) {
    const itemState = item.status === "ready"
      ? "ready"
      : item.status === "unknown"
        ? "unknown"
        : "blocked";
    lines.push(`- ${checkLabels[item.id]}: ${itemState}`);
    for (const reason of item.reasons) {
      lines.push(`  ${reasonMessages[reason] ?? "A readiness condition could not be verified."}`);
    }
  }
  lines.push("This check did not change external configuration or publish a package.");
  return `${lines.join("\n")}\n`;
}
