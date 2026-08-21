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
} from "../lib/first-publication-bootstrap-authorization.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "../lib/first-publication-bootstrap-reader.mjs";
import { observeNpmPublicPackage } from "../lib/npm-public-package-observer.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import { createFirstPublicationFixture } from "./fixtures/first-publication.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const observedAt = "2026-08-21T03:00:00Z";

function fixture() {
  const source = createFirstPublicationFixture();
  return {
    publicationAuthorization: structuredClone(source.publicationAuthorization),
    packageManifest: structuredClone(source.packageManifest),
    releaseManifest: structuredClone(source.releaseManifest),
    externalEvidenceReport: structuredClone(source.externalEvidenceReport),
    packageObservation: structuredClone(source.packageObservation),
    approval: structuredClone(source.approval),
    observedAt,
  };
}

function redigestEvidenceReport(report) {
  const { evidenceReportDigest: _oldDigest, ...body } = report;
  report.evidenceReportDigest = canonicalDigest(body);
}

describe("first-publication bootstrap contract", () => {
  it("binds a reviewed identity, exact release, fresh absence and stage-only transition", () => {
    const input = fixture();
    const first = createFirstPublicationBootstrapAuthorization(input);
    const second = createFirstPublicationBootstrapAuthorization(input);
    assert.equal(first.status, "bootstrap_authorized");
    assert.equal(first.schemaVersion, 2);
    assert.equal(first.bootstrapDigest, second.bootstrapDigest);
    assert.equal(first.registryObservation.validUntil, "2026-08-21T03:09:00.000Z");
    assert.equal(
      first.evidence.externalEvidenceReportDigest,
      input.externalEvidenceReport.evidenceReportDigest,
    );
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

  it("rejects unresolved package identity and an evidence report for another release", () => {
    const unresolved = fixture();
    unresolved.packageManifest.license = "UNLICENSED";
    assert.throws(
      () => createFirstPublicationBootstrapAuthorization(unresolved),
      { code: "first_publication_identity_unresolved" },
    );
    const mismatched = fixture();
    mismatched.externalEvidenceReport.release.publicationAuthorizationDigest =
      `sha256:${"f".repeat(64)}`;
    redigestEvidenceReport(mismatched.externalEvidenceReport);
    assert.throws(
      () => createFirstPublicationBootstrapAuthorization(mismatched),
      { code: "first_publication_external_evidence_target_mismatch" },
    );
  });

  it("rejects expired evidence and a package that appeared before authorization", () => {
    const expired = fixture();
    expired.externalEvidenceReport.validity.validUntil = observedAt;
    redigestEvidenceReport(expired.externalEvidenceReport);
    assert.throws(
      () => createFirstPublicationBootstrapAuthorization(expired),
      { code: "first_publication_external_evidence_expired" },
    );
    const existing = fixture();
    existing.packageObservation.state = "existing";
    assert.throws(
      () => createFirstPublicationBootstrapAuthorization(existing),
      { code: "first_publication_package_not_missing" },
    );
  });

  it("rejects legacy v1 bootstrap documents instead of silently bypassing evidence", () => {
    const bootstrap = createFirstPublicationBootstrapAuthorization(fixture());
    bootstrap.schemaVersion = 1;
    assert.throws(
      () => validateFirstPublicationBootstrapAuthorization(bootstrap),
      { code: "first_publication_bootstrap_schema_unsupported" },
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

  it("rejects the legacy --approval input before reading release sources", () => {
    const result = spawnSync(process.execPath, [
      "scripts/authorize-cli-first-publication-bootstrap.mjs",
      "--online",
      "--release-directory", "/tmp/release",
      "--publication-authorization", "/tmp/publication.json",
      "--approval", "/tmp/approval.json",
      "--output", "/tmp/bootstrap.json",
    ], { cwd: repositoryRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^first_publication_bootstrap_arguments_invalid:/u);
  });

  it("requires an explicit online boundary before reading release inputs", async () => {
    let sourceReads = 0;
    await assert.rejects(
      authorizeCliFirstPublicationBootstrap({
        online: false,
        releaseDirectory: "/release",
        publicationAuthorizationPath: "/authorization.json",
        externalEvidencePath: "/external-evidence.json",
      }, {
        readSources: async () => {
          sourceReads += 1;
          return fixture();
        },
      }),
      { code: "first_publication_online_required" },
    );
    assert.equal(sourceReads, 0);
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
        externalEvidencePath: "/external-evidence.json",
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
      externalEvidencePath: "/external-evidence.json",
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
