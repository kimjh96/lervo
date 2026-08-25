import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { describe, it } from "vitest";

import { verifyCliReleaseAttestations } from "../lib/cli-release-attestation-consumer.mjs";
import {
  inTotoStatementType,
  localUnsignedBuilderId,
  slsaProvenanceType,
} from "../lib/cli-release-attestation.mjs";
import {
  createReleaseSubject,
  cyclonedxPredicateType,
} from "../lib/release-attestation-consumer.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const repository = "lervo-dev/lervo";
const sourceDigest = "b".repeat(40);

async function prepareReleaseFixture() {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-consumer-test-"));
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
  const attestationDirectory = resolve(releaseDirectory, "attestations");
  await mkdir(attestationDirectory);
  await Promise.all([
    writeFile(resolve(attestationDirectory, "build-provenance.sigstore.json"), "{}\n"),
    writeFile(resolve(attestationDirectory, "sbom.sigstore.json"), "{}\n"),
  ]);
  return {
    temporaryRoot,
    releaseDirectory,
    tag: `v${packageManifest.version}`,
  };
}

function verifiedResult(statement) {
  return [
    {
      attestation: {},
      verificationResult: {
        signature: { certificate: {} },
        verifiedTimestamps: [{}],
        statement,
      },
    },
  ];
}

describe("CLI release attestation consumer orchestration", () => {
  it("verifies both bundles against one immutable release set", async () => {
    const fixture = await prepareReleaseFixture();
    const calls = [];
    try {
      const report = await verifyCliReleaseAttestations(
        {
          releaseDirectory: fixture.releaseDirectory,
          repository,
          tag: fixture.tag,
          sourceDigest,
        },
        {
          verifyGitHubAttestation: async (input) => {
            calls.push(input);
            const tarballContents = await readFile(input.artifactPath);
            const tarballSubject = createReleaseSubject(
              basename(input.artifactPath),
              tarballContents,
            );
            if (input.predicateType === slsaProvenanceType) {
              return verifiedResult({
                _type: inTotoStatementType,
                subject: [
                  tarballSubject,
                  createReleaseSubject(
                    "release-artifact-manifest.json",
                    await readFile(
                      resolve(fixture.releaseDirectory, "release-artifact-manifest.json"),
                    ),
                  ),
                  createReleaseSubject(
                    "release-sbom.cdx.json",
                    await readFile(resolve(fixture.releaseDirectory, "release-sbom.cdx.json")),
                  ),
                ],
                predicateType: slsaProvenanceType,
                predicate: {},
              });
            }
            return verifiedResult({
              _type: inTotoStatementType,
              subject: [tarballSubject],
              predicateType: cyclonedxPredicateType,
              predicate: JSON.parse(
                await readFile(resolve(fixture.releaseDirectory, "release-sbom.cdx.json"), "utf8"),
              ),
            });
          },
        },
      );

      assert.equal(report.status, "verified");
      assert.equal(report.subjects.length, 3);
      assert.deepEqual(
        calls.map(({ predicateType }) => predicateType),
        [slsaProvenanceType, cyclonedxPredicateType],
      );
      assert.equal(
        calls.every(({ policy }) => policy.sourceDigest === sourceDigest),
        true,
      );

      await writeFile(resolve(fixture.releaseDirectory, "unexpected.txt"), "extra");
      await assert.rejects(
        verifyCliReleaseAttestations(
          {
            releaseDirectory: fixture.releaseDirectory,
            repository,
            tag: fixture.tag,
            sourceDigest,
          },
          {
            verifyGitHubAttestation: async () => {
              calls.push("unexpected verifier call");
              return [];
            },
          },
        ),
        { code: "release_attestation_release_set_invalid" },
      );
      assert.equal(calls.length, 2);
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });

  it("does not invoke a verifier for a local unsigned statement", async () => {
    const fixture = await prepareReleaseFixture();
    let calls = 0;
    try {
      await writeFile(
        resolve(fixture.releaseDirectory, "attestations/build-provenance.sigstore.json"),
        JSON.stringify({
          _type: inTotoStatementType,
          predicate: { runDetails: { builder: { id: localUnsignedBuilderId } } },
        }),
      );
      await assert.rejects(
        verifyCliReleaseAttestations(
          {
            releaseDirectory: fixture.releaseDirectory,
            repository,
            tag: fixture.tag,
            sourceDigest,
          },
          {
            verifyGitHubAttestation: async () => {
              calls += 1;
              return [];
            },
          },
        ),
        { code: "release_attestation_unsigned_untrusted" },
      );
      assert.equal(calls, 0);
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });
});
