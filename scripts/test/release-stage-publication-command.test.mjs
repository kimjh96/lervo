import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

import { describe, it } from "vitest";

import { stageCliReleasePublication } from "../lib/cli-release-stage-publication.mjs";
import { createReleaseSubject } from "../lib/release-attestation-consumer.mjs";
import { readReleaseStagePublicationSources } from "../lib/release-stage-publication-sources.mjs";
import {
  createReleasePublicationArtifact,
  createReleasePublicationAuthorization,
} from "../lib/release-publication-authorization.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function releaseFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-stage-command-"));
  const releaseDirectory = resolve(root, "release");
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
  const attestationDirectory = resolve(releaseDirectory, "attestations");
  await mkdir(attestationDirectory);
  await Promise.all([
    writeFile(resolve(attestationDirectory, "build-provenance.sigstore.json"), "{}\n"),
    writeFile(resolve(attestationDirectory, "sbom.sigstore.json"), "{}\n"),
  ]);
  const tarballPath = resolve(releaseDirectory, `lervo-cli-${packageManifest.version}.tgz`);
  const subjectPaths = [
    tarballPath,
    resolve(releaseDirectory, "release-artifact-manifest.json"),
    resolve(releaseDirectory, "release-sbom.cdx.json"),
  ];
  const subjects = await Promise.all(
    subjectPaths.map(async (path) => createReleaseSubject(basename(path), await readFile(path))),
  );
  const tarballContents = await readFile(tarballPath);
  const artifact = createReleasePublicationArtifact(
    basename(tarballPath),
    packageManifest.version,
    tarballContents,
  );
  const authorization = createReleasePublicationAuthorization({
    version: packageManifest.version,
    distTag: "latest",
    artifact,
    verification: {
      schemaVersion: 1,
      status: "verified",
      repository: "lervo-dev/lervo",
      workflow: ".github/workflows/cli-release-matrix.yml",
      tag: `v${packageManifest.version}`,
      sourceDigest: "d".repeat(40),
      subjects,
    },
  });
  const publicationAuthorizationPath = resolve(root, "publication-authorization.json");
  await writeFile(publicationAuthorizationPath, `${JSON.stringify(authorization, null, 2)}\n`);
  return {
    root,
    releaseDirectory,
    publicationAuthorizationPath,
    resultDirectory: resolve(root, "result"),
    authorization,
  };
}

function acceptedReceipt(authorization) {
  return {
    schemaVersion: 1,
    status: "stage_submission_accepted",
    operation: "npm_stage_publish",
    target: structuredClone(authorization.target),
    artifact: structuredClone(authorization.artifact),
    evidence: "npm_cli_exit_zero",
  };
}

describe("CLI release stage publication command boundary", () => {
  it("reads the bounded verified file set and invokes only the injected stage port", async () => {
    const fixture = await releaseFixture();
    try {
      let calls = 0;
      const terminal = await stageCliReleasePublication(fixture, {
        prepareStage: async ({ target, artifact, tarballPath }) => {
          assert.deepEqual(target, fixture.authorization.target);
          assert.deepEqual(artifact, fixture.authorization.artifact);
          assert.equal(
            tarballPath,
            resolve(fixture.releaseDirectory, fixture.authorization.artifact.file),
          );
          return {
            stage: async () => {
              calls += 1;
              return acceptedReceipt(fixture.authorization);
            },
            dispose: async () => {},
          };
        },
        clock: (() => {
          const values = ["2026-08-21T06:00:00Z", "2026-08-21T06:01:00Z"];
          return () => values.shift();
        })(),
      });
      assert.equal(calls, 1);
      assert.equal(terminal.state, "staged");
      assert.equal(
        JSON.parse(await readFile(resolve(fixture.resultDirectory, "terminal.json"))).state,
        "staged",
      );

      const sbomPath = resolve(fixture.releaseDirectory, "release-sbom.cdx.json");
      await writeFile(sbomPath, `${await readFile(sbomPath, "utf8")}\n`);
      await assert.rejects(readReleaseStagePublicationSources(fixture), {
        code: "release_stage_publication_source_mismatch",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects incomplete, relative, duplicate, and unknown CLI arguments", () => {
    for (const args of [
      [],
      ["--release-directory", "relative"],
      ["--result-directory", "/tmp/a", "--result-directory", "/tmp/b"],
      ["--online", "yes"],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/stage-cli-release-publication.mjs", ...args],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^release_stage_publication_arguments_invalid:/u);
    }
  });
});
