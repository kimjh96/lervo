import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, it } from "vitest";

import { checkCliTrustedPublisherReadiness } from "../lib/cli-trusted-publisher-readiness.mjs";
import { observeGitHubPublisherEnvironment } from "../first-publication/adapters/github-environment-observer.mjs";
import { observeNpmTrustedPublisher } from "../first-publication/adapters/npm-trust-observer.mjs";
import { npmPublicRegistry } from "../lib/release-publication-authorization.mjs";
import { createTrustedPublisherReadinessReport } from "../lib/trusted-publisher-readiness.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const repository = "lervo-dev/lervo";

function readyPackageManifest() {
  return {
    name: "@lervo/cli",
    version: "0.1.0",
    license: "MIT",
    private: false,
    repository: {
      type: "git",
      url: `git+https://github.com/${repository}.git`,
    },
    publishConfig: {
      access: "public",
      registry: npmPublicRegistry,
    },
  };
}

function npmObservation(overrides = {}) {
  return {
    schemaVersion: 1,
    source: "npm_trust",
    state: "configured",
    package: "@lervo/cli",
    provider: "github",
    repository,
    workflow: "cli-release-matrix.yml",
    environment: "npm-release",
    permissions: ["createStagedPackage"],
    ...overrides,
  };
}

function githubObservation(overrides = {}) {
  return {
    schemaVersion: 1,
    source: "github_environment",
    state: "observed",
    repository,
    environment: "npm-release",
    requiredReviewerCount: 2,
    preventSelfReview: true,
    tagPolicies: ["v*"],
    ...overrides,
  };
}

describe("trusted publisher readiness contract", () => {
  it("reports ready only when every local and external condition is exact", () => {
    const input = {
      repository,
      packageManifest: readyPackageManifest(),
      workflow: { jobs: { "attested-cli": { run: "pnpm release:attestation:verify" } } },
      npmObservation: npmObservation(),
      githubObservation: githubObservation(),
    };
    const first = createTrustedPublisherReadinessReport(input);
    const second = createTrustedPublisherReadinessReport(input);
    assert.equal(first.status, "ready");
    assert.equal(first.readinessDigest, second.readinessDigest);
    assert.equal(
      first.checks.every(({ status }) => status === "ready"),
      true,
    );
  });

  it("keeps missing observations unknown and unresolved local identity blocked", () => {
    const report = createTrustedPublisherReadinessReport({
      repository,
      packageManifest: {
        ...readyPackageManifest(),
        license: "UNLICENSED",
        repository: undefined,
        publishConfig: { access: "public" },
      },
      workflow: { jobs: {} },
    });
    assert.equal(report.status, "blocked");
    assert.deepEqual(report.checks[0].reasons, [
      "package_repository_missing",
      "package_license_unresolved",
      "package_registry_unpinned",
    ]);
    assert.equal(report.checks[1].status, "ready");
    assert.deepEqual(
      report.checks.slice(2).map(({ status }) => status),
      ["unknown", "unknown", "unknown"],
    );
  });

  it("keeps public package absence separate from unobserved npm trust", () => {
    const report = createTrustedPublisherReadinessReport({
      repository,
      packageManifest: readyPackageManifest(),
      workflow: { jobs: {} },
      npmObservation: {
        schemaVersion: 1,
        source: "npm_trust",
        state: "public_package_not_found",
        package: "@lervo/cli",
      },
      githubObservation: githubObservation(),
    });
    assert.deepEqual(report.checks[2].reasons, ["npm_public_package_not_visible"]);
    assert.deepEqual(report.checks[3].reasons, ["npm_trust_not_observed"]);
    assert.equal(report.checks[3].status, "unknown");
    assert.equal(report.checks[4].status, "ready");
  });

  it("rejects broader publisher permissions, self-review, and an active publish job", () => {
    const report = createTrustedPublisherReadinessReport({
      repository,
      packageManifest: readyPackageManifest(),
      workflow: {
        jobs: {
          "publish-cli": {
            environment: "npm-release",
            run: "npm publish ./lervo-cli.tgz",
          },
        },
      },
      npmObservation: npmObservation({
        permissions: ["createPackage", "createStagedPackage"],
      }),
      githubObservation: githubObservation({
        requiredReviewerCount: 0,
        preventSelfReview: false,
        tagPolicies: ["*"],
      }),
    });
    assert.equal(report.status, "blocked");
    assert.deepEqual(report.checks[1].reasons, ["publish_job_already_active"]);
    assert.deepEqual(report.checks[3].reasons, ["npm_publisher_permission_mismatch"]);
    assert.deepEqual(report.checks[4].reasons, [
      "github_required_reviewer_missing",
      "github_self_review_allowed",
      "github_release_tag_policy_mismatch",
    ]);
  });

  it("the repository command reports the current blockers without network access", () => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/release/commands/check-cli-trusted-publisher-readiness.mjs",
        "--repository",
        repository,
        "--json",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "blocked");
    // The license is settled (Apache-2.0); repository and registry metadata remain open.
    assert.deepEqual(report.checks[0].reasons, [
      "package_repository_missing",
      "package_registry_unpinned",
    ]);
    assert.equal(report.checks[1].status, "ready");
  });

  it("the default orchestrator never invokes online observers", async () => {
    const unexpected = async () => assert.fail("online observer must not run");
    const report = await checkCliTrustedPublisherReadiness(
      { repository },
      {
        observeNpmTrustedPublisher: unexpected,
        observeGitHubPublisherEnvironment: unexpected,
      },
    );
    assert.equal(report.status, "blocked");
    assert.deepEqual(
      report.checks.slice(2).map(({ status }) => status),
      ["unknown", "unknown", "unknown"],
    );
  });
});

describe("npm trust observer", () => {
  it("uses the read-only list command and removes the trust identifier", async () => {
    const calls = [];
    const observation = await observeNpmTrustedPublisher({
      request: async () => ({ ok: true, status: 200 }),
      execute: async (_command, args) => {
        calls.push(args);
        if (args[0] === "--version") return { stdout: "11.17.0\n", stderr: "" };
        return {
          stdout: JSON.stringify({
            id: "registry-internal-trust-id",
            type: "github",
            repository,
            file: "cli-release-matrix.yml",
            environment: "npm-release",
            permissions: ["createStagedPackage"],
          }),
          stderr: "",
        };
      },
    });
    assert.deepEqual(calls[1], [
      "trust",
      "list",
      "@lervo/cli",
      "--registry",
      npmPublicRegistry,
      "--json",
    ]);
    assert.deepEqual(observation, npmObservation());
    assert.equal("id" in observation, false);
  });

  it("distinguishes no configuration from an unsupported client", async () => {
    const notConfigured = await observeNpmTrustedPublisher({
      request: async () => ({ ok: true, status: 200 }),
      execute: async (_command, args) => ({
        stdout: args[0] === "--version" ? "11.15.0\n" : "\n",
        stderr: "",
      }),
    });
    assert.equal(notConfigured.state, "not_configured");
    let calls = 0;
    const unsupported = await observeNpmTrustedPublisher({
      request: async () => ({ ok: true, status: 200 }),
      execute: async () => {
        calls += 1;
        return { stdout: "11.14.0\n", stderr: "" };
      },
    });
    assert.equal(unsupported.state, "unavailable");
    assert.equal(unsupported.reason, "client_unsupported");
    assert.equal(calls, 1);
  });

  it("reports a public 404 without requesting npm credentials", async () => {
    let calls = 0;
    const observation = await observeNpmTrustedPublisher({
      request: async () => ({ ok: false, status: 404 }),
      execute: async () => {
        calls += 1;
        throw new Error("npm must not run");
      },
    });
    assert.deepEqual(observation, {
      schemaVersion: 1,
      source: "npm_trust",
      state: "public_package_not_found",
      package: "@lervo/cli",
    });
    assert.equal(calls, 0);
  });
});

describe("GitHub environment observer", () => {
  it("reads protection and tag policy endpoints without retaining reviewer identities", async () => {
    const calls = [];
    const observation = await observeGitHubPublisherEnvironment({
      repository,
      execute: async (_command, args) => {
        calls.push(args);
        if (!args.at(-1).includes("deployment-branch-policies")) {
          return {
            stdout: JSON.stringify({
              name: "npm-release",
              protection_rules: [
                {
                  type: "required_reviewers",
                  prevent_self_review: true,
                  reviewers: [
                    { type: "User", reviewer: { login: "release-reviewer" } },
                    { type: "Team", reviewer: { slug: "maintainers" } },
                  ],
                },
              ],
              deployment_branch_policy: {
                protected_branches: false,
                custom_branch_policies: true,
              },
            }),
            stderr: "",
          };
        }
        return {
          stdout: JSON.stringify({
            total_count: 1,
            branch_policies: [{ id: 7, name: "v*", type: "tag" }],
          }),
          stderr: "",
        };
      },
    });
    assert.deepEqual(observation, githubObservation());
    assert.equal(JSON.stringify(observation).includes("release-reviewer"), false);
    assert.equal(calls.length, 2);
    assert.equal(
      calls.every((args) => args[0] === "api" && args[2] === "GET"),
      true,
    );
  });

  it("returns a bounded unavailable observation when the environment cannot be read", async () => {
    const observation = await observeGitHubPublisherEnvironment({
      repository,
      execute: async () => {
        throw new Error("raw response with credential and path");
      },
    });
    assert.deepEqual(observation, {
      schemaVersion: 1,
      source: "github_environment",
      state: "unavailable",
      reason: "authentication_or_environment_unavailable",
    });
  });
});
