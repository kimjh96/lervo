import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { describe, it } from "vitest";

import {
  authorizeCliReleasePublication,
  writeReleasePublicationAuthorization,
} from "../lib/cli-release-publication-authorization.mjs";
import { createReleaseSubject } from "../lib/release-attestation-consumer.mjs";
import { executeAuthorizedReleasePublication } from "../lib/release-publication-executor.mjs";
import {
  createReleasePublicationArtifact,
  createReleasePublicationAuthorization,
  npmPublicRegistry,
  validateReleasePublicationAuthorization,
} from "../lib/release-publication-authorization.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const repository = "lervo-dev/lervo";
const sourceDigest = "c".repeat(40);

async function prepareFixture() {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-publication-test-"));
  const releaseDirectory = resolve(temporaryRoot, "release");
  const packageManifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "apps/cli/package.json"), "utf8"),
  );
  const result = spawnSync(
    process.execPath,
    [
      "scripts/check-cli-release-attestation.mjs",
      "--prepare",
      releaseDirectory,
      "--expected-tag",
      `v${packageManifest.version}`,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const tarballPath = resolve(releaseDirectory, `lervo-cli-${packageManifest.version}.tgz`);
  const subjects = await Promise.all(
    [
      tarballPath,
      resolve(releaseDirectory, "release-artifact-manifest.json"),
      resolve(releaseDirectory, "release-sbom.cdx.json"),
    ].map(async (path) => createReleaseSubject(basename(path), await readFile(path))),
  );
  return {
    temporaryRoot,
    releaseDirectory,
    tarballPath,
    version: packageManifest.version,
    verification: {
      schemaVersion: 1,
      status: "verified",
      repository,
      workflow: ".github/workflows/cli-release-matrix.yml",
      tag: `v${packageManifest.version}`,
      sourceDigest,
      subjects,
      attestations: [],
    },
  };
}

describe("CLI release publication authorization", () => {
  it("binds the verified release to exact registry coordinates and digests", async () => {
    const fixture = await prepareFixture();
    try {
      const authorization = await authorizeCliReleasePublication(
        {
          releaseDirectory: fixture.releaseDirectory,
          repository,
          tag: `v${fixture.version}`,
          sourceDigest,
          distTag: "latest",
        },
        {
          verifyCliReleaseAttestations: async () => fixture.verification,
        },
      );
      assert.equal(authorization.status, "eligible");
      assert.deepEqual(authorization.target, {
        registry: npmPublicRegistry,
        package: "@lervo/cli",
        version: fixture.version,
        distTag: "latest",
        access: "public",
      });
      assert.match(authorization.artifact.registryIntegrity, /^sha512-/u);
      assert.equal(validateReleasePublicationAuthorization(authorization), authorization);

      const outputPath = resolve(fixture.temporaryRoot, "authorization.json");
      await writeReleasePublicationAuthorization(outputPath, authorization);
      assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), authorization);
      await assert.rejects(writeReleasePublicationAuthorization(outputPath, authorization), {
        code: "EEXIST",
      });

      const changed = structuredClone(authorization);
      changed.target.distTag = "next";
      assert.throws(() => validateReleasePublicationAuthorization(changed), {
        code: "release_publication_authorization_invalid",
      });
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsupported tags and an unverified release result", async () => {
    const fixture = await prepareFixture();
    try {
      const artifact = createReleasePublicationArtifact(
        basename(fixture.tarballPath),
        fixture.version,
        await readFile(fixture.tarballPath),
      );
      assert.throws(
        () =>
          createReleasePublicationAuthorization({
            verification: fixture.verification,
            version: fixture.version,
            distTag: "preview-7",
            artifact,
          }),
        { code: "release_publication_input_invalid" },
      );
      assert.throws(
        () =>
          createReleasePublicationAuthorization({
            verification: { ...fixture.verification, status: "unverified" },
            version: fixture.version,
            distTag: "latest",
            artifact,
          }),
        { code: "release_publication_input_invalid" },
      );
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rechecks tarball bytes before and after the privileged publisher port", async () => {
    const fixture = await prepareFixture();
    try {
      const authorization = await authorizeCliReleasePublication(
        {
          releaseDirectory: fixture.releaseDirectory,
          repository,
          tag: `v${fixture.version}`,
          sourceDigest,
          distTag: "next",
        },
        {
          verifyCliReleaseAttestations: async () => fixture.verification,
        },
      );
      let calls = 0;
      const report = await executeAuthorizedReleasePublication(
        {
          authorization,
          releaseDirectory: fixture.releaseDirectory,
        },
        {
          publish: async ({ target, artifact, tarballPath }) => {
            calls += 1;
            assert.equal(tarballPath, fixture.tarballPath);
            return {
              registry: target.registry,
              package: target.package,
              version: target.version,
              distTag: target.distTag,
              registryIntegrity: artifact.registryIntegrity,
              registryShasum: artifact.registryShasum,
            };
          },
        },
      );
      assert.equal(calls, 1);
      assert.equal(report.status, "published");

      await writeFile(fixture.tarballPath, "changed");
      await assert.rejects(
        executeAuthorizedReleasePublication(
          {
            authorization,
            releaseDirectory: fixture.releaseDirectory,
          },
          { publish: async () => assert.fail("publisher must not be called") },
        ),
        { code: "release_publication_artifact_changed" },
      );
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });
});
