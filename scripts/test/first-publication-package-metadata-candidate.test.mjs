import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { createFirstPublicationMetadataDecision } from
  "../lib/first-publication-metadata-decision.mjs";
import { createFirstPublicationMetadataPreview } from
  "../lib/first-publication-metadata-preview.mjs";
import {
  createFirstPublicationPackageMetadataCandidate,
  validateFirstPublicationPackageMetadataCandidate,
} from "../lib/first-publication-package-metadata-candidate.mjs";
import { canonicalDigest, sha256 } from "../lib/release-artifact-manifest.mjs";
import { npmPublicRegistry } from "../lib/release-publication-authorization.mjs";
import {
  activationRepository,
  currentActivationSources,
  replaceActivationReleaseArtifact,
} from "./fixtures/first-publication-activation.mjs";

const license = "Apache-2.0";
const repositoryUrl = `git+https://github.com/${activationRepository}.git`;

function decision() {
  return createFirstPublicationMetadataDecision({
    repository: activationRepository,
    license,
    scopeOwnerKind: "organization",
    scopeOwnerName: "lervo",
  });
}

function candidateInput(sources) {
  const selected = decision();
  const contents = Buffer.from(`${JSON.stringify(sources.packageManifest, null, 2)}\n`);
  const input = {
    ...sources,
    sourceSnapshots: {
      packageManifest: {
        contents,
        byteCount: contents.length,
        sha256: sha256(contents),
      },
    },
    decision: selected,
  };
  return { ...input, preview: createFirstPublicationMetadataPreview(input) };
}

function withoutPatchFields(manifest) {
  const copy = structuredClone(manifest);
  delete copy.repository;
  delete copy.license;
  delete copy.publishConfig.registry;
  delete copy.publishConfig.provenance;
  return copy;
}

async function alignedSources() {
  const sources = await currentActivationSources();
  sources.packageManifest = {
    ...sources.packageManifest,
    repository: { type: "git", url: repositoryUrl },
    license,
    publishConfig: { access: "public", registry: npmPublicRegistry, provenance: true },
  };
  sources.releaseManifest = replaceActivationReleaseArtifact(sources.releaseManifest, {
    repository: repositoryUrl,
    license,
    registry: npmPublicRegistry,
    provenance: true,
  });
  return sources;
}

describe("first-publication package metadata candidate", () => {
  it("creates the exact package bytes while preserving unrelated fields", async () => {
    const sources = await currentActivationSources();
    const input = candidateInput(sources);
    const result = createFirstPublicationPackageMetadataCandidate(input);
    const output = JSON.parse(result.outputBytes.toString("utf8"));

    assert.deepEqual(output.repository, { type: "git", url: repositoryUrl });
    assert.equal(output.license, license);
    assert.equal(output.publishConfig.registry, npmPublicRegistry);
    assert.equal(output.publishConfig.provenance, true);
    assert.deepEqual(withoutPatchFields(output), withoutPatchFields(sources.packageManifest));
    assert.equal(result.candidate.status, "review_required");
    assert.equal(result.candidate.writesAllowed, false);
    assert.equal(result.candidate.output.sha256, sha256(result.outputBytes));
    assert.equal(result.candidate.sources.packageSourceSha256,
      sha256(input.sourceSnapshots.packageManifest.contents));
    assert.match(result.candidate.candidateDigest, /^sha256:[a-f0-9]{64}$/u);
  });

  it("does not mutate the source snapshot", async () => {
    const input = candidateInput(await currentActivationSources());
    const before = Buffer.from(input.sourceSnapshots.packageManifest.contents);
    createFirstPublicationPackageMetadataCandidate(input);
    assert.deepEqual(input.sourceSnapshots.packageManifest.contents, before);
  });

  it("rejects a candidate when no package fields need changing", async () => {
    const input = candidateInput(await alignedSources());
    assert.throws(
      () => createFirstPublicationPackageMetadataCandidate(input),
      { code: "first_publication_package_metadata_patch_no_changes" },
    );
  });

  it("rejects non-canonical source bytes instead of silently reformatting them", async () => {
    const input = candidateInput(await currentActivationSources());
    const contents = Buffer.from(JSON.stringify(input.packageManifest));
    input.sourceSnapshots.packageManifest = {
      contents,
      byteCount: contents.length,
      sha256: sha256(contents),
    };
    assert.throws(
      () => createFirstPublicationPackageMetadataCandidate(input),
      { code: "first_publication_package_metadata_source_format_unsupported" },
    );
  });

  it("rejects source snapshot metadata that does not match its bytes", async () => {
    const input = candidateInput(await currentActivationSources());
    input.sourceSnapshots.packageManifest.byteCount += 1;
    assert.throws(
      () => createFirstPublicationPackageMetadataCandidate(input),
      { code: "first_publication_package_metadata_candidate_invalid" },
    );
  });

  it("rejects a redigested claim that the candidate may write", async () => {
    const input = candidateInput(await currentActivationSources());
    const result = createFirstPublicationPackageMetadataCandidate(input);
    result.candidate.writesAllowed = true;
    const { candidateDigest: _discarded, ...body } = result.candidate;
    result.candidate.candidateDigest = canonicalDigest(body);
    assert.throws(
      () => validateFirstPublicationPackageMetadataCandidate(result, input),
      { code: "first_publication_package_metadata_candidate_invalid" },
    );
  });

  it("rejects output bytes that do not match the bound digest", async () => {
    const input = candidateInput(await currentActivationSources());
    const result = createFirstPublicationPackageMetadataCandidate(input);
    result.outputBytes = Buffer.from("{}\n");
    assert.throws(
      () => validateFirstPublicationPackageMetadataCandidate(result, input),
      { code: "first_publication_package_metadata_candidate_invalid" },
    );
  });
});
