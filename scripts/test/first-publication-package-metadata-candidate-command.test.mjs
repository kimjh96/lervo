import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { inspectCliFirstPublicationPackageMetadataCandidate } from
  "../lib/cli-first-publication-package-metadata-candidate.mjs";
import { createFirstPublicationMetadataDecision } from
  "../lib/first-publication-metadata-decision.mjs";
import { createFirstPublicationPackageMetadataCandidate } from
  "../lib/first-publication-package-metadata-candidate.mjs";
import { formatFirstPublicationPackageMetadataCandidate } from
  "../lib/first-publication-package-metadata-candidate-formatter.mjs";
import { sha256 } from "../lib/release-artifact-manifest.mjs";
import {
  activationRepository,
  activationRepositoryRoot,
  createActivationSourceFiles,
} from "./fixtures/first-publication-activation.mjs";

const command = "scripts/show-cli-first-publication-package-metadata-candidate.mjs";
const validArguments = [
  "--repository", activationRepository,
  "--license", "Apache-2.0",
  "--scope-owner-kind", "organization",
  "--scope-owner-name", "lervo",
];

function decision() {
  return createFirstPublicationMetadataDecision({
    repository: activationRepository,
    license: "Apache-2.0",
    scopeOwnerKind: "organization",
    scopeOwnerName: "lervo",
  });
}

function run(args) {
  return spawnSync(process.execPath, [command, ...args], {
    cwd: activationRepositoryRoot,
    encoding: "utf8",
  });
}

describe("first-publication package metadata candidate command", () => {
  it("reads immutable snapshots without creating candidate files", async () => {
    const prepared = await createActivationSourceFiles();
    try {
      const beforeNames = await readdir(prepared.root);
      const beforePackage = await readFile(prepared.paths.packageManifestPath);
      const result = await inspectCliFirstPublicationPackageMetadataCandidate(
        decision(),
        prepared.paths,
      );
      assert.equal(result.candidate.status, "review_required");
      assert.deepEqual(await readdir(prepared.root), beforeNames);
      assert.deepEqual(await readFile(prepared.paths.packageManifestPath), beforePackage);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects source changes made while the candidate is built", async () => {
    const prepared = await createActivationSourceFiles();
    try {
      await assert.rejects(inspectCliFirstPublicationPackageMetadataCandidate(
        decision(),
        prepared.paths,
        {
          createCandidate: async (input) => {
            const result = createFirstPublicationPackageMetadataCandidate(input);
            await writeFile(prepared.paths.packageManifestPath, "{}\n");
            return result;
          },
        },
      ), { code: "release_attestation_release_set_changed" });
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("explains the review boundary in plain English", async () => {
    const prepared = await createActivationSourceFiles();
    try {
      const result = await inspectCliFirstPublicationPackageMetadataCandidate(
        decision(),
        prepared.paths,
      );
      const output = formatFirstPublicationPackageMetadataCandidate(result.candidate);
      assert.match(output, /Review is required; this candidate cannot be applied yet/u);
      assert.match(output, /--package-json/u);
      assert.match(output, /did not modify files, rebuild the release manifest, create approvals/u);
      assert.equal(output.includes(result.candidate.candidateDigest), false);
      assert.equal(output.includes(result.candidate.sources.packageSourceSha256), false);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("prints separately verifiable candidate metadata and exact package bytes", async () => {
    const packagePath = resolve(activationRepositoryRoot, "apps/cli/package.json");
    const releasePath = resolve(
      activationRepositoryRoot,
      "apps/cli/release-artifact-manifest.json",
    );
    const before = await Promise.all([readFile(packagePath), readFile(releasePath)]);
    const metadataResult = run([...validArguments, "--json"]);
    const bytesResult = run([...validArguments, "--package-json"]);
    assert.equal(metadataResult.status, 0);
    assert.equal(metadataResult.stderr, "");
    assert.equal(bytesResult.status, 0);
    assert.equal(bytesResult.stderr, "");
    const candidate = JSON.parse(metadataResult.stdout);
    const output = JSON.parse(bytesResult.stdout);
    assert.equal(candidate.output.sha256, sha256(Buffer.from(bytesResult.stdout)));
    assert.equal(output.name, "@lervo/cli");
    assert.equal(output.license, "Apache-2.0");
    assert.equal(output.publishConfig.provenance, true);
    assert.deepEqual(await Promise.all([readFile(packagePath), readFile(releasePath)]), before);
  });

  it("rejects mixed output modes and malformed arguments", () => {
    for (const args of [
      [],
      [...validArguments, "--json", "--package-json"],
      [...validArguments, "--package-json", "--package-json"],
      [...validArguments, "--license", "MIT"],
      [...validArguments, "--online"],
      [...validArguments, "--unknown", "value"],
    ]) {
      const result = run(args);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(
        result.stderr,
        /^first_publication_package_metadata_candidate_arguments_invalid:/u,
      );
    }
  });

  it("does not expose invalid decision values in errors", () => {
    const secret = "secret-license-value";
    const result = run([
      ...validArguments.slice(0, 2),
      "--license", `${secret}\nunsafe`,
      ...validArguments.slice(4),
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^first_publication_metadata_decision_invalid:/u);
    assert.equal(result.stderr.includes(secret), false);
  });
});
