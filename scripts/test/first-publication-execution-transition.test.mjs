import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createFirstPublicationBootstrapAuthorization } from
  "../lib/first-publication-bootstrap.mjs";
import {
  executeFirstPublicationBootstrap,
} from "../lib/first-publication-execution.mjs";
import { validateFirstPublicationExecutionReceipt } from
  "../lib/first-publication-execution-receipt.mjs";
import {
  createFirstPublicationTransitionReport,
  stageOnlyPublicationCommand,
} from "../lib/first-publication-transition-policy.mjs";
import {
  createFirstPublicationTransitionReceipt,
  validateFirstPublicationTransitionReceipt,
} from "../lib/first-publication-transition.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import {
  createReleasePublicationArtifact,
  createReleasePublicationAuthorization,
  npmPublicRegistry,
} from "../lib/release-publication-authorization.mjs";

const repository = "lervo-dev/lervo";
const tarballContents = Buffer.from("first-publication-execution-tarball");

function fixture() {
  const version = "0.1.0";
  const artifact = createReleasePublicationArtifact(
    `lervo-cli-${version}.tgz`,
    version,
    tarballContents,
  );
  const publicationAuthorization = createReleasePublicationAuthorization({
    verification: {
      schemaVersion: 1,
      status: "verified",
      repository,
      workflow: ".github/workflows/cli-release-matrix.yml",
      tag: `v${version}`,
      sourceDigest: "a".repeat(40),
      subjects: [
        { name: artifact.file, digest: { sha256: artifact.sha256 } },
        { name: "release-artifact-manifest.json", digest: { sha256: "b".repeat(64) } },
        { name: "release-sbom.cdx.json", digest: { sha256: "c".repeat(64) } },
      ],
    },
    version,
    distTag: "latest",
    artifact,
  });
  const bootstrap = createFirstPublicationBootstrapAuthorization({
    publicationAuthorization,
    packageManifest: {
      name: "@lervo/cli",
      version,
      license: "Apache-2.0",
      private: false,
      repository: { type: "git", url: `git+https://github.com/${repository}.git` },
      publishConfig: {
        access: "public",
        registry: npmPublicRegistry,
        provenance: true,
      },
    },
    releaseManifest: {
      artifact: {
        name: "@lervo/cli",
        version,
        license: "Apache-2.0",
        repository: `git+https://github.com/${repository}.git`,
        registry: npmPublicRegistry,
        provenance: true,
        private: false,
        access: "public",
      },
    },
    approval: {
      schemaVersion: 1,
      approvalId: "apr_execute1",
      decision: "approve_first_publication",
      approvedAt: "2026-08-21T02:55:00Z",
      expiresAt: "2026-08-21T04:00:00Z",
      approver: { kind: "user", id: "release-owner@example.invalid" },
      target: {
        package: "@lervo/cli",
        repository,
        license: "Apache-2.0",
        scopeOwner: { kind: "organization", name: "lervo" },
        publicationAuthorizationDigest: publicationAuthorization.authorizationDigest,
      },
      confirmations: [
        "license_approved",
        "one_time_direct_publish_approved",
        "package_name_availability_confirmed",
        "scope_control_confirmed",
        "stage_only_transition_required",
      ],
    },
    packageObservation: {
      schemaVersion: 1,
      source: "npm_public_registry",
      state: "not_found",
      package: "@lervo/cli",
    },
    observedAt: "2026-08-21T03:00:00Z",
  });
  return { publicationAuthorization, bootstrap, artifact };
}

function registryMissing() {
  return {
    schemaVersion: 1,
    source: "npm_public_registry",
    state: "not_found",
    package: "@lervo/cli",
  };
}

function memoryStore(events, overrides = {}) {
  return {
    reserve: async (reservation) => {
      events.push("reserve");
      return reservation;
    },
    complete: async (completion) => {
      events.push("complete");
      return completion;
    },
    abort: async (abortion) => {
      events.push("abort");
      return abortion;
    },
    markUnknown: async (unknown) => {
      events.push(`unknown:${unknown.retry}`);
      return unknown;
    },
    ...overrides,
  };
}

async function executeFixture({ storeOverrides, publish, contents = tarballContents } = {}) {
  const source = fixture();
  const releaseDirectory = await mkdtemp(resolve(tmpdir(), "lervo-execution-test-"));
  const events = [];
  await writeFile(resolve(releaseDirectory, source.artifact.file), contents);
  try {
    const receipt = await executeFirstPublicationBootstrap({
      bootstrap: source.bootstrap,
      publicationAuthorization: source.publicationAuthorization,
      releaseDirectory,
    }, {
      reservationStore: memoryStore(events, storeOverrides),
      observePackage: async () => {
        events.push("observe");
        return registryMissing();
      },
      publish: publish ?? (async ({ target, artifact }) => {
        events.push("publish");
        return {
          registry: target.registry,
          package: target.package,
          version: target.version,
          distTag: target.distTag,
          registryIntegrity: artifact.registryIntegrity,
          registryShasum: artifact.registryShasum,
        };
      }),
      clock: (() => {
        const values = ["2026-08-21T03:01:00Z", "2026-08-21T03:02:00Z"];
        return () => values.shift();
      })(),
    });
    return { ...source, receipt, events };
  } finally {
    await rm(releaseDirectory, { recursive: true, force: true });
  }
}

function activeWorkflow() {
  return {
    jobs: {
      "publish-cli": {
        if: "github.event_name == 'workflow_dispatch' && github.ref_type == 'tag'",
        needs: "attested-cli",
        "runs-on": "ubuntu-latest",
        environment: "npm-release",
        permissions: { contents: "read", "id-token": "write" },
        steps: [
          { name: "Download exact release", uses: "actions/download-artifact@digest" },
          { name: "Install dependencies", run: "pnpm install --frozen-lockfile" },
          { name: "Stage exact CLI package", run: stageOnlyPublicationCommand },
        ],
      },
    },
  };
}

function transitionInput(executed) {
  return {
    bootstrap: executed.bootstrap,
    executionReceipt: executed.receipt,
    workflow: activeWorkflow(),
    npmObservation: {
      schemaVersion: 1,
      source: "npm_trust",
      state: "configured",
      package: "@lervo/cli",
      provider: "github",
      repository,
      workflow: "cli-release-matrix.yml",
      environment: "npm-release",
      permissions: ["createStagedPackage"],
    },
    githubObservation: {
      schemaVersion: 1,
      source: "github_environment",
      state: "observed",
      repository,
      environment: "npm-release",
      requiredReviewerCount: 1,
      preventSelfReview: true,
      tagPolicies: ["v*"],
    },
    observedAt: "2026-08-21T03:10:00Z",
  };
}

describe("first-publication execution", () => {
  it("reserves before publishing and persists an exact transition-pending receipt", async () => {
    const executed = await executeFixture();
    assert.deepEqual(executed.events, ["observe", "reserve", "publish", "complete"]);
    assert.equal(executed.receipt.status, "published_transition_pending");
    assert.equal(executed.receipt.transition.state, "pending");
    assert.equal(
      validateFirstPublicationExecutionReceipt(executed.receipt, executed.bootstrap),
      executed.receipt,
    );
  });

  it("does not reserve or publish when package absence is not confirmed", async () => {
    const source = fixture();
    let writes = 0;
    await assert.rejects(
      executeFirstPublicationBootstrap({
        bootstrap: source.bootstrap,
        publicationAuthorization: source.publicationAuthorization,
        releaseDirectory: "/release",
      }, {
        reservationStore: memoryStore([], {
          reserve: async () => { writes += 1; },
        }),
        observePackage: async () => ({
          schemaVersion: 1,
          source: "npm_public_registry",
          state: "existing",
          package: "@lervo/cli",
        }),
        publish: async () => { writes += 1; },
      }),
      { code: "first_publication_package_not_available" },
    );
    assert.equal(writes, 0);
  });

  it("stops before publishing when the one-time reservation is unavailable", async () => {
    let publishCalls = 0;
    await assert.rejects(
      executeFixture({
        storeOverrides: { reserve: async () => { throw new Error("already reserved"); } },
        publish: async () => { publishCalls += 1; },
      }),
      { code: "first_publication_reservation_failed" },
    );
    assert.equal(publishCalls, 0);
  });

  it("records a known pre-publication abort without claiming an unknown publish", async () => {
    const events = [];
    await assert.rejects(
      executeFixture({
        contents: Buffer.from("changed"),
        storeOverrides: {
          reserve: async (reservation) => {
            events.push("reserve");
            return reservation;
          },
          abort: async (abortion) => {
            events.push(abortion.state);
            return abortion;
          },
          markUnknown: async () => events.push("unknown"),
        },
      }),
      { code: "release_publication_artifact_changed" },
    );
    assert.deepEqual(events, ["reserve", "aborted_before_publication"]);
  });

  it("marks an attempted publication unknown and forbids blind retry", async () => {
    const events = [];
    await assert.rejects(
      executeFixture({
        storeOverrides: {
          markUnknown: async (unknown) => {
            events.push(unknown);
            return unknown;
          },
        },
        publish: async () => { throw new Error("connection ended after upload"); },
      }),
      { code: "first_publication_outcome_unknown" },
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].state, "publication_unknown");
    assert.equal(events[0].retry, "forbidden");
  });

  it("treats a mismatched registry receipt as unknown after the publisher was called", async () => {
    const events = [];
    await assert.rejects(
      executeFixture({
        storeOverrides: {
          markUnknown: async (unknown) => {
            events.push(unknown.state);
            return unknown;
          },
        },
        publish: async ({ target, artifact }) => ({
          registry: target.registry,
          package: target.package,
          version: target.version,
          distTag: "next",
          registryIntegrity: artifact.registryIntegrity,
          registryShasum: artifact.registryShasum,
        }),
      }),
      { code: "first_publication_outcome_unknown" },
    );
    assert.deepEqual(events, ["publication_unknown"]);
  });

  it("does not return success when the durable completion is incomplete", async () => {
    const events = [];
    await assert.rejects(
      executeFixture({
        storeOverrides: {
          complete: async (completion) => ({
            state: completion.state,
            executionReceiptDigest: completion.executionReceiptDigest,
          }),
          markUnknown: async (unknown) => {
            events.push(unknown.state);
            return unknown;
          },
        },
      }),
      { code: "first_publication_outcome_unknown" },
    );
    assert.deepEqual(events, ["publication_unknown"]);
  });
});

describe("first-publication stage-only transition", () => {
  it("consumes the bootstrap only after all three independent controls are ready", async () => {
    const executed = await executeFixture();
    const input = transitionInput(executed);
    const report = createFirstPublicationTransitionReport(input);
    const receipt = createFirstPublicationTransitionReceipt({
      ...input,
      completedAt: input.observedAt,
    });
    assert.equal(report.status, "ready");
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.bootstrap.state, "consumed");
    assert.equal(receipt.transition.directPublish, "forbidden");
    assert.equal(
      validateFirstPublicationTransitionReceipt(receipt, {
        bootstrap: input.bootstrap,
        executionReceipt: input.executionReceipt,
        workflow: input.workflow,
        npmObservation: input.npmObservation,
        githubObservation: input.githubObservation,
      }),
      receipt,
    );
  });

  it("blocks broad npm authority, direct publish, and self-review independently", async () => {
    const executed = await executeFixture();
    const broadNpm = transitionInput(executed);
    broadNpm.npmObservation.permissions = ["createPackage", "createStagedPackage"];
    assert.deepEqual(
      createFirstPublicationTransitionReport(broadNpm).checks[1].reasons,
      ["npm_publisher_permission_mismatch"],
    );
    assert.throws(
      () => createFirstPublicationTransitionReceipt({
        ...broadNpm,
        completedAt: broadNpm.observedAt,
      }),
      { code: "first_publication_transition_not_ready" },
    );

    const direct = transitionInput(executed);
    direct.workflow.jobs["publish-cli"].steps.push({ run: "npm publish package.tgz" });
    assert.ok(
      createFirstPublicationTransitionReport(direct).checks[0].reasons
        .includes("direct_publish_command_present"),
    );

    const selfReview = transitionInput(executed);
    selfReview.githubObservation.preventSelfReview = false;
    assert.deepEqual(
      createFirstPublicationTransitionReport(selfReview).checks[2].reasons,
      ["github_self_review_allowed"],
    );
  });

  it("rejects a redigested completion that was not derived from current evidence", async () => {
    const executed = await executeFixture();
    const input = transitionInput(executed);
    const receipt = createFirstPublicationTransitionReceipt({
      ...input,
      completedAt: input.observedAt,
    });
    receipt.transition.permission = "createPackage";
    const { transitionReceiptDigest: _oldDigest, ...body } = receipt;
    receipt.transitionReceiptDigest = canonicalDigest(body);
    assert.throws(
      () => validateFirstPublicationTransitionReceipt(receipt, {
        bootstrap: input.bootstrap,
        executionReceipt: input.executionReceipt,
        workflow: input.workflow,
        npmObservation: input.npmObservation,
        githubObservation: input.githubObservation,
      }),
      { code: "first_publication_transition_receipt_invalid" },
    );
  });
});
