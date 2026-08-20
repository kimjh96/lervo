import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "vitest";

import {
  createLocalCliReleaseStatement,
  inTotoStatementType,
  localUnsignedBuilderId,
  slsaProvenanceType,
  validateCliReleaseTag,
  validateLocalCliReleaseStatement,
} from "../lib/cli-release-attestation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  return {
    tarballName: "lervo-cli-0.1.0.tgz",
    tarballContents: Buffer.from("packed-cli"),
    releaseManifestContents: Buffer.from('{"schemaVersion":5}\n'),
    releaseSbomContents: Buffer.from('{"bomFormat":"CycloneDX"}\n'),
    packageManifestContents: Buffer.from('{"name":"@lervo/cli"}\n'),
    packageReadmeContents: Buffer.from("# @lervo/cli\n"),
    bundleContents: Buffer.from("#!/usr/bin/env node\n"),
    lockfileContents: Buffer.from("lockfileVersion: '9.0'\n"),
    nodeVersion: "v22.13.0",
    packageManager: "pnpm@11.18.0",
    platform: "linux",
    architecture: "x64",
  };
}

describe("local CLI release statement", () => {
  it("binds the tarball, manifest and SBOM as distinct in-toto subjects", () => {
    const inputs = fixture();
    const statement = createLocalCliReleaseStatement(inputs);

    assert.equal(statement._type, inTotoStatementType);
    assert.equal(statement.predicateType, slsaProvenanceType);
    assert.deepEqual(statement.subject.map(({ name }) => name), [
      "lervo-cli-0.1.0.tgz",
      "release-artifact-manifest.json",
      "release-sbom.cdx.json",
    ]);
    assert.equal(statement.subject[0].digest.sha256, sha256(inputs.tarballContents));
    assert.equal(statement.subject[1].digest.sha256, sha256(inputs.releaseManifestContents));
    assert.equal(statement.subject[2].digest.sha256, sha256(inputs.releaseSbomContents));
  });

  it("records only bounded release assembly inputs and an explicit unsigned builder", () => {
    const inputs = fixture();
    const statement = createLocalCliReleaseStatement(inputs);
    const { buildDefinition, runDetails } = statement.predicate;

    assert.deepEqual(buildDefinition.resolvedDependencies.map(({ name }) => name), [
      "apps/cli/README.md",
      "apps/cli/dist/bin.js",
      "apps/cli/package.json",
      "apps/cli/release-artifact-manifest.json",
      "apps/cli/release-sbom.cdx.json",
      "pnpm-lock.yaml",
    ]);
    assert.deepEqual(buildDefinition.externalParameters, {});
    assert.deepEqual(buildDefinition.internalParameters, {
      architecture: "x64",
      nodeVersion: "v22.13.0",
      packageManager: "pnpm@11.18.0",
      platform: "linux",
    });
    assert.equal(runDetails.builder.id, localUnsignedBuilderId);
    assert.equal(Object.hasOwn(runDetails, "metadata"), false);
    assert.equal(Object.hasOwn(statement, "signatures"), false);
  });

  it("rejects a subject digest changed after statement creation", () => {
    const inputs = fixture();
    const statement = createLocalCliReleaseStatement(inputs);
    statement.subject[0].digest.sha256 = "a".repeat(64);

    assert.throws(
      () => validateLocalCliReleaseStatement(statement, inputs),
      { code: "release_attestation_statement_mismatch" },
    );
  });

  it("rejects an unsigned local statement disguised as a signature envelope", () => {
    const inputs = fixture();
    const statement = createLocalCliReleaseStatement(inputs);
    statement.signatures = [];

    assert.throws(
      () => validateLocalCliReleaseStatement(statement, inputs),
      { code: "release_attestation_envelope_unexpected" },
    );
  });

  it("requires the selected release tag to match the package version", () => {
    assert.equal(validateCliReleaseTag("0.1.0", "v0.1.0"), "v0.1.0");
    assert.throws(
      () => validateCliReleaseTag("0.1.0", "v0.1.1"),
      { code: "release_attestation_tag_mismatch" },
    );
  });

  it("prepares only the three release subjects and refuses to overwrite them", async () => {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-attestation-test-"));
    const outputDirectory = resolve(temporaryRoot, "release");
    const packageManifest = JSON.parse(
      await readFile(resolve(repositoryRoot, "apps/cli/package.json"), "utf8"),
    );
    const command = [
      "scripts/check-cli-release-attestation.mjs",
      "--prepare",
      outputDirectory,
      "--expected-tag",
      `v${packageManifest.version}`,
    ];
    try {
      const first = spawnSync(process.execPath, command, {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      assert.equal(first.status, 0, first.stderr);
      assert.deepEqual((await readdir(outputDirectory)).sort(), [
        `lervo-cli-${packageManifest.version}.tgz`,
        "release-artifact-manifest.json",
        "release-sbom.cdx.json",
      ]);

      const second = spawnSync(process.execPath, command, {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      assert.equal(second.status, 1);
      assert.match(second.stderr, /^release_attestation_output_unavailable:/u);
      assert.equal((await readdir(outputDirectory)).length, 3);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
