import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "vitest";

import {
  authorizeCliFirstPublicationBootstrap,
  writeFirstPublicationBootstrapAuthorization,
} from
  "../lib/cli-first-publication-bootstrap.mjs";
import {
  createFirstPublicationBootstrapAuthorization,
} from "../lib/first-publication-bootstrap.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "../lib/first-publication-bootstrap-reader.mjs";
import { observeNpmPublicPackage } from "../lib/npm-public-package-observer.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import {
  createReleasePublicationArtifact,
  createReleasePublicationAuthorization,
  npmPublicRegistry,
} from "../lib/release-publication-authorization.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const repository = "lervo-dev/lervo";
const observedAt = "2026-08-21T03:00:00Z";

function fixture() {
  const version = "0.1.0";
  const artifact = createReleasePublicationArtifact(
    `lervo-cli-${version}.tgz`,
    version,
    Buffer.from("first-publication-tarball"),
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
  const packageManifest = {
    name: "@lervo/cli",
    version,
    license: "Apache-2.0",
    private: false,
    repository: {
      type: "git",
      url: `git+https://github.com/${repository}.git`,
    },
    publishConfig: {
      access: "public",
      registry: npmPublicRegistry,
      provenance: true,
    },
  };
  const releaseManifest = {
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
  };
  const approval = {
    schemaVersion: 1,
    approvalId: "apr_release1",
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
  };
  return {
    publicationAuthorization,
    packageManifest,
    releaseManifest,
    approval,
    packageObservation: {
      schemaVersion: 1,
      source: "npm_public_registry",
      state: "not_found",
      package: "@lervo/cli",
    },
    observedAt,
  };
}

describe("first-publication bootstrap contract", () => {
  it("binds a reviewed identity, exact release, fresh absence and stage-only transition", () => {
    const input = fixture();
    const first = createFirstPublicationBootstrapAuthorization(input);
    const second = createFirstPublicationBootstrapAuthorization(input);
    assert.equal(first.status, "bootstrap_authorized");
    assert.equal(first.bootstrapDigest, second.bootstrapDigest);
    assert.equal(first.registryObservation.validUntil, "2026-08-21T03:10:00.000Z");
    assert.deepEqual(first.execution, {
      mode: "manual_interactive_once",
      requiresFreshPackageAbsenceCheck: true,
      requiresTwoFactorAuthentication: true,
      reusable: false,
    });
    assert.deepEqual(first.transition, {
      nextMode: "trusted_publisher_stage_only",
      workflow: "cli-release-matrix.yml",
      environment: "npm-release",
      permission: "createStagedPackage",
      directPublishAfterBootstrap: "forbidden",
    });
    assert.equal(JSON.stringify(first).includes(input.approval.approver.id), false);
    assert.equal(validateFirstPublicationBootstrapAuthorization(first), first);
  });

  it("rejects unresolved package identity and an approval for another release", () => {
    const unresolved = fixture();
    unresolved.packageManifest.license = "UNLICENSED";
    assert.throws(
      () => createFirstPublicationBootstrapAuthorization(unresolved),
      { code: "first_publication_identity_unresolved" },
    );
    const mismatched = fixture();
    mismatched.approval.target.publicationAuthorizationDigest = `sha256:${"d".repeat(64)}`;
    assert.throws(
      () => createFirstPublicationBootstrapAuthorization(mismatched),
      { code: "first_publication_approval_invalid" },
    );
  });

  it("rejects an expired approval and a package that appeared before authorization", () => {
    const expired = fixture();
    expired.approval.expiresAt = observedAt;
    assert.throws(
      () => createFirstPublicationBootstrapAuthorization(expired),
      { code: "first_publication_approval_expired" },
    );
    const existing = fixture();
    existing.packageObservation.state = "existing";
    assert.throws(
      () => createFirstPublicationBootstrapAuthorization(existing),
      { code: "first_publication_package_not_missing" },
    );
  });

  it("rejects broader direct-publish transition authority even after redigesting", () => {
    const bootstrap = createFirstPublicationBootstrapAuthorization(fixture());
    bootstrap.transition.permission = "createPackage";
    const { bootstrapDigest: _oldDigest, ...body } = bootstrap;
    bootstrap.bootstrapDigest = canonicalDigest(body);
    assert.throws(
      () => validateFirstPublicationBootstrapAuthorization(bootstrap),
      { code: "first_publication_bootstrap_invalid" },
    );
  });

  it("writes a new authorization once and refuses replacement", async () => {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-bootstrap-test-"));
    try {
      const outputPath = resolve(temporaryRoot, "bootstrap.json");
      const bootstrap = createFirstPublicationBootstrapAuthorization(fixture());
      await writeFirstPublicationBootstrapAuthorization(outputPath, bootstrap);
      assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), bootstrap);
      await assert.rejects(
        writeFirstPublicationBootstrapAuthorization(outputPath, bootstrap),
        { code: "EEXIST" },
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("requires an explicit online boundary before reading release inputs", () => {
    const result = spawnSync(process.execPath, [
      "scripts/authorize-cli-first-publication-bootstrap.mjs",
      "--release-directory", "/tmp/release",
      "--publication-authorization", "/tmp/publication.json",
      "--approval", "/tmp/approval.json",
      "--output", "/tmp/bootstrap.json",
    ], { cwd: repositoryRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^first_publication_bootstrap_arguments_invalid:/u);
  });

  it("rejects unresolved local inputs before calling the registry observer", async () => {
    const sources = fixture();
    sources.packageManifest.license = "UNLICENSED";
    sources.assertUnchanged = async () => assert.fail("snapshot check must not be reached");
    let observerCalls = 0;
    await assert.rejects(
      authorizeCliFirstPublicationBootstrap({
        online: true,
        releaseDirectory: "/release",
        publicationAuthorizationPath: "/authorization.json",
        approvalPath: "/approval.json",
      }, {
        readSources: async () => sources,
        observeNpmPublicPackage: async () => {
          observerCalls += 1;
          return sources.packageObservation;
        },
        now: () => observedAt,
      }),
      { code: "first_publication_identity_unresolved" },
    );
    assert.equal(observerCalls, 0);
  });

  it("rechecks every source snapshot after the public registry observation", async () => {
    const sources = fixture();
    let snapshotChecks = 0;
    sources.assertUnchanged = async () => { snapshotChecks += 1; };
    const bootstrap = await authorizeCliFirstPublicationBootstrap({
      online: true,
      releaseDirectory: "/release",
      publicationAuthorizationPath: "/authorization.json",
      approvalPath: "/approval.json",
    }, {
      readSources: async () => sources,
      observeNpmPublicPackage: async () => sources.packageObservation,
      now: () => observedAt,
    });
    assert.equal(bootstrap.status, "bootstrap_authorized");
    assert.equal(snapshotChecks, 1);
  });
});

describe("npm public package observer", () => {
  it("distinguishes missing, existing and unavailable without reading response bodies", async () => {
    const missing = await observeNpmPublicPackage({
      request: async () => ({ ok: false, status: 404 }),
    });
    const existing = await observeNpmPublicPackage({
      request: async () => ({ ok: true, status: 200 }),
    });
    const unavailable = await observeNpmPublicPackage({
      request: async () => { throw new Error("secret response"); },
    });
    assert.equal(missing.state, "not_found");
    assert.equal(existing.state, "existing");
    assert.deepEqual(unavailable, {
      schemaVersion: 1,
      source: "npm_public_registry",
      state: "unavailable",
      package: "@lervo/cli",
      reason: "registry_unavailable",
    });
  });
});
