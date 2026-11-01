import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";

import { describe, it } from "vitest";

import {
  createFirstPublicationPackageMetadataDerivedRelease,
  generateFirstPublicationPackageMetadataDerivedRelease,
} from "../first-publication-package-metadata-derived-release.mjs";
import { generateFirstPublicationPackageMetadataPostApplyRelease } from "../first-publication-package-metadata-post-apply-release.mjs";
import {
  canonicalDigest,
  releaseArtifactDigest,
} from "../../../../shared/release-artifact-manifest.mjs";
import {
  applyMetadataFixture,
  createMetadataApplyFixture,
  currentBuildMetadataSources,
} from "../../test/fixtures/first-publication-metadata-apply.mjs";

describe("first-publication package metadata derived release", () => {
  it("uses the production release generator without changing repository sources", async () => {
    const fixture = await createMetadataApplyFixture(await currentBuildMetadataSources());
    try {
      const before = await readFile(fixture.paths.packageManifestPath);
      const generated = await generateFirstPublicationPackageMetadataDerivedRelease({
        currentReleaseManifest: fixture.sources.releaseManifest,
        currentReleaseSbom: fixture.sources.releaseSbom,
        lockfile: fixture.lockfile,
        candidateResult: fixture.candidateEvidence.candidateResult,
      });
      assert.deepEqual(
        generated.outputBytes.releaseManifest,
        fixture.derivedRelease.outputBytes.releaseManifest,
      );
      assert.deepEqual(
        generated.outputBytes.releaseSbom,
        fixture.derivedRelease.outputBytes.releaseSbom,
      );
      assert.deepEqual(await readFile(fixture.paths.packageManifestPath), before);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it("reproduces an applied release manifest with the production generator", async () => {
    const fixture = await createMetadataApplyFixture(await currentBuildMetadataSources());
    try {
      await applyMetadataFixture(fixture);
      const before = await readFile(fixture.paths.packageManifestPath);
      const generated = await generateFirstPublicationPackageMetadataPostApplyRelease({
        packageManifest: fixture.derivedRelease.packageManifest,
        releaseManifest: fixture.derivedRelease.releaseManifest,
      });
      assert.deepEqual(generated, fixture.derivedRelease.releaseManifest);
      assert.deepEqual(await readFile(fixture.paths.packageManifestPath), before);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it("regenerates the release manifest and SBOM from the reviewed package candidate", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      assert.equal(fixture.derivedRelease.releaseManifest.artifact.license, "Apache-2.0");
      assert.equal(
        fixture.derivedRelease.releaseManifest.artifact.repository,
        "git+https://github.com/lervo-dev/lervo.git",
      );
      assert.equal(fixture.derivedRelease.releaseManifest.artifact.provenance, true);
      assert.equal(
        fixture.derivedRelease.releaseSbom.metadata.component.licenses[0].license.name,
        "Apache-2.0",
      );
      assert.notEqual(
        fixture.derivedRelease.releaseSbom.serialNumber,
        fixture.sources.releaseSbom.serialNumber,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a generator that changes an unrelated release section", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const generated = structuredClone(fixture.derivedRelease.releaseManifest);
      generated.archive.files[0].size += 1;
      generated.archive.contentDigest = canonicalDigest(generated.archive.files);
      generated.artifactDigest = releaseArtifactDigest(generated);
      assert.throws(
        () =>
          createFirstPublicationPackageMetadataDerivedRelease({
            currentReleaseManifest: fixture.sources.releaseManifest,
            currentReleaseSbom: fixture.sources.releaseSbom,
            lockfile: fixture.lockfile,
            candidateResult: fixture.candidateEvidence.candidateResult,
            generatedReleaseManifest: generated,
          }),
        {
          code: "first_publication_package_metadata_release_regeneration_invalid",
        },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a stale current SBOM before creating replacement bytes", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const stale = structuredClone(fixture.sources.releaseSbom);
      stale.serialNumber = "urn:uuid:00000000-0000-5000-8000-000000000000";
      assert.throws(
        () =>
          createFirstPublicationPackageMetadataDerivedRelease({
            currentReleaseManifest: fixture.sources.releaseManifest,
            currentReleaseSbom: stale,
            lockfile: fixture.lockfile,
            candidateResult: fixture.candidateEvidence.candidateResult,
            generatedReleaseManifest: fixture.derivedRelease.releaseManifest,
          }),
        {
          code: "first_publication_package_metadata_release_regeneration_invalid",
        },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
