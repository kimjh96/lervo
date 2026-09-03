import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { inspectCliFirstPublicationPackageMetadataApplyPermit } from "../cli-first-publication-package-metadata-apply-permit.mjs";
import { createValidatedFirstPublicationPackageMetadataCandidate } from "../cli-first-publication-package-metadata-candidate.mjs";
import { readFirstPublicationActivationSources } from "../../shared/first-publication-activation-sources.mjs";
import { createFirstPublicationMetadataDecision } from "../first-publication-metadata-decision.mjs";
import { createFirstPublicationPackageMetadataApplyPermit } from "../first-publication-package-metadata-apply-permit.mjs";
import { formatFirstPublicationPackageMetadataApplyPermit } from "../first-publication-package-metadata-apply-permit-formatter.mjs";
import {
  activationRepository,
  activationRepositoryRoot,
  createActivationSourceFiles,
} from "../../test/fixtures/first-publication-activation.mjs";

const command =
  "scripts/release/first-publication/metadata/commands/show-cli-first-publication-package-metadata-apply-permit.mjs";
const candidateCommand =
  "scripts/release/first-publication/metadata/commands/show-cli-first-publication-package-metadata-candidate.mjs";
const decisionArguments = [
  "--repository",
  activationRepository,
  "--license",
  "Apache-2.0",
  "--scope-owner-kind",
  "organization",
  "--scope-owner-name",
  "lervo",
];

function decision() {
  return createFirstPublicationMetadataDecision({
    repository: activationRepository,
    license: "Apache-2.0",
    scopeOwnerKind: "organization",
    scopeOwnerName: "lervo",
  });
}

function reviewFor(candidateResult) {
  return {
    actorKind: "human_operator",
    confirmation: "reviewed_exact_candidate",
    candidateDigest: candidateResult.candidate.candidateDigest,
    packageSourceSha256: candidateResult.candidate.sources.packageSourceSha256,
    outputSha256: candidateResult.candidate.output.sha256,
  };
}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: activationRepositoryRoot,
    encoding: "utf8",
  });
}

function currentPermitArguments() {
  const result = run(candidateCommand, [...decisionArguments, "--json"]);
  assert.equal(result.status, 0);
  const candidate = JSON.parse(result.stdout);
  return [
    ...decisionArguments,
    "--reviewed-candidate-digest",
    candidate.candidateDigest,
    "--reviewed-source-sha256",
    candidate.sources.packageSourceSha256,
    "--reviewed-output-sha256",
    candidate.output.sha256,
    "--confirm-reviewed-candidate",
  ];
}

async function preparedEvidence() {
  const prepared = await createActivationSourceFiles();
  const selected = decision();
  const sources = await readFirstPublicationActivationSources(prepared.paths);
  const candidateResult = await createValidatedFirstPublicationPackageMetadataCandidate(
    selected,
    sources,
  );
  return { prepared, selected, candidateResult, review: reviewFor(candidateResult) };
}

describe("first-publication package metadata apply permit command", () => {
  it("creates no file while producing a content-bound permit", async () => {
    const { prepared, selected, review } = await preparedEvidence();
    try {
      const beforeNames = await readdir(prepared.root);
      const beforePackage = await readFile(prepared.paths.packageManifestPath);
      const permit = await inspectCliFirstPublicationPackageMetadataApplyPermit(
        selected,
        review,
        prepared.paths,
      );
      assert.equal(permit.status, "apply_permitted");
      assert.deepEqual(await readdir(prepared.root), beforeNames);
      assert.deepEqual(await readFile(prepared.paths.packageManifestPath), beforePackage);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects source changes made while the permit is built", async () => {
    const { prepared, selected, review } = await preparedEvidence();
    try {
      await assert.rejects(
        inspectCliFirstPublicationPackageMetadataApplyPermit(selected, review, prepared.paths, {
          createPermit: async (input) => {
            const permit = createFirstPublicationPackageMetadataApplyPermit(input);
            await writeFile(prepared.paths.packageManifestPath, "{}\n");
            return permit;
          },
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("explains the conditional authority and non-writing boundary in plain English", async () => {
    const { prepared, selected, review } = await preparedEvidence();
    try {
      const permit = await inspectCliFirstPublicationPackageMetadataApplyPermit(
        selected,
        review,
        prepared.paths,
      );
      const output = formatFirstPublicationPackageMetadataApplyPermit(permit);
      assert.match(output, /only while the reviewed source and candidate remain unchanged/u);
      assert.match(output, /release manifest must be rebuilt.*not edited directly/u);
      assert.match(output, /did not modify files, rebuild the release manifest/u);
      assert.equal(output.includes(permit.permitDigest), false);
      assert.equal(output.includes(permit.binding.packageSourceSha256), false);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("prints a verifiable permit and preserves both repository manifests", async () => {
    const packagePath = resolve(activationRepositoryRoot, "apps/cli/package.json");
    const releasePath = resolve(
      activationRepositoryRoot,
      "apps/cli/release-artifact-manifest.json",
    );
    const before = await Promise.all([readFile(packagePath), readFile(releasePath)]);
    const result = run(command, [...currentPermitArguments(), "--json"]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const permit = JSON.parse(result.stdout);
    assert.equal(permit.status, "apply_permitted");
    assert.equal(permit.authority.packageManifest, "replace_if_source_matches");
    assert.equal(permit.sideEffects.metadata, "not_changed");
    assert.match(permit.permitDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(await Promise.all([readFile(packagePath), readFile(releasePath)]), before);
  });

  it("rejects missing, duplicate, online, package output, and unknown arguments", () => {
    const validArguments = currentPermitArguments();
    for (const args of [
      [],
      validArguments.filter((value) => value !== "--confirm-reviewed-candidate"),
      [...validArguments, "--confirm-reviewed-candidate"],
      [...validArguments, "--json", "--json"],
      [...validArguments, "--package-json"],
      [...validArguments, "--online"],
      [...validArguments, "--unknown", "value"],
    ]) {
      const result = run(command, args);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(
        result.stderr,
        /^first_publication_package_metadata_apply_permit_arguments_invalid:/u,
      );
    }
  });

  it("does not expose a mismatched reviewed digest in errors", () => {
    const secret = "secret-reviewed-digest";
    const args = currentPermitArguments();
    const index = args.indexOf("--reviewed-output-sha256");
    args[index + 1] = secret;
    const result = run(command, args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^first_publication_package_metadata_apply_review_invalid:/u);
    assert.equal(result.stderr.includes(secret), false);
  });
});
