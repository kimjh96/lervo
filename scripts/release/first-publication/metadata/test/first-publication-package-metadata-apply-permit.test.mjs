import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { describe, it } from "vitest";

import { createValidatedFirstPublicationPackageMetadataCandidateEvidence } from "../cli-first-publication-package-metadata-candidate.mjs";
import { readFirstPublicationActivationSources } from "../../shared/first-publication-activation-sources.mjs";
import { createFirstPublicationMetadataDecision } from "../first-publication-metadata-decision.mjs";
import {
  createFirstPublicationPackageMetadataApplyPermit,
  validateFirstPublicationPackageMetadataApplyPermit,
} from "../first-publication-package-metadata-apply-permit.mjs";
import { canonicalDigest } from "../../../../shared/release-artifact-manifest.mjs";
import {
  activationRepository,
  createActivationSourceFiles,
} from "../../test/fixtures/first-publication-activation.mjs";

function decision() {
  return createFirstPublicationMetadataDecision({
    repository: activationRepository,
    license: "Apache-2.0",
    scopeOwnerKind: "organization",
    scopeOwnerName: "lervo",
  });
}

function reviewFor(candidateResult, overrides = {}) {
  return {
    actorKind: "human_operator",
    confirmation: "reviewed_exact_candidate",
    candidateDigest: candidateResult.candidate.candidateDigest,
    packageSourceSha256: candidateResult.candidate.sources.packageSourceSha256,
    outputSha256: candidateResult.candidate.output.sha256,
    ...overrides,
  };
}

async function evidence() {
  const prepared = await createActivationSourceFiles();
  const selected = decision();
  const sources = await readFirstPublicationActivationSources(prepared.paths);
  const candidateEvidence = await createValidatedFirstPublicationPackageMetadataCandidateEvidence(
    selected,
    sources,
  );
  return {
    prepared,
    input: {
      ...candidateEvidence,
      decision: selected,
      review: reviewFor(candidateEvidence.candidateResult),
    },
  };
}

describe("first-publication package metadata apply permit", () => {
  it("binds the human decision to the exact source, candidate, and output", async () => {
    const { prepared, input } = await evidence();
    try {
      const permit = createFirstPublicationPackageMetadataApplyPermit(input);
      assert.equal(permit.status, "apply_permitted");
      assert.equal(permit.binding.candidateDigest, input.review.candidateDigest);
      assert.equal(permit.binding.packageSourceSha256, input.review.packageSourceSha256);
      assert.equal(permit.binding.outputSha256, input.review.outputSha256);
      assert.equal(permit.authority.packageManifest, "replace_if_source_matches");
      assert.equal(permit.authority.directReleaseManifestPatch, "forbidden");
      assert.equal(permit.sideEffects.metadata, "not_changed");
      assert.match(permit.permitDigest, /^sha256:[a-f0-9]{64}$/u);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects every missing or mismatched review binding", async () => {
    const { prepared, input } = await evidence();
    try {
      for (const review of [
        { ...input.review, confirmation: "not_reviewed" },
        { ...input.review, actorKind: "agent" },
        { ...input.review, candidateDigest: `sha256:${"0".repeat(64)}` },
        { ...input.review, packageSourceSha256: `sha256:${"0".repeat(64)}` },
        { ...input.review, outputSha256: `sha256:${"0".repeat(64)}` },
        { ...input.review, extra: "not_allowed" },
      ]) {
        assert.throws(
          () => createFirstPublicationPackageMetadataApplyPermit({ ...input, review }),
          { code: "first_publication_package_metadata_apply_review_invalid" },
        );
      }
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects candidate bytes that no longer match the reviewed output", async () => {
    const { prepared, input } = await evidence();
    try {
      input.candidateResult.outputBytes = Buffer.from("{}\n");
      assert.throws(() => createFirstPublicationPackageMetadataApplyPermit(input), {
        code: "first_publication_package_metadata_apply_permit_invalid",
      });
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects a redigested permit with broader write authority", async () => {
    const { prepared, input } = await evidence();
    try {
      const permit = createFirstPublicationPackageMetadataApplyPermit(input);
      permit.authority.packageManifest = "replace_any_source";
      const { permitDigest: _discarded, ...body } = permit;
      permit.permitDigest = canonicalDigest(body);
      assert.throws(() => validateFirstPublicationPackageMetadataApplyPermit(permit, input), {
        code: "first_publication_package_metadata_apply_permit_invalid",
      });
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects a valid permit against a different candidate", async () => {
    const { prepared, input } = await evidence();
    try {
      const permit = createFirstPublicationPackageMetadataApplyPermit(input);
      const changedInput = {
        ...input,
        candidateResult: {
          candidate: structuredClone(input.candidateResult.candidate),
          outputBytes: Buffer.from(input.candidateResult.outputBytes),
        },
      };
      changedInput.candidateResult.candidate.output.byteCount += 1;
      assert.throws(
        () => validateFirstPublicationPackageMetadataApplyPermit(permit, changedInput),
        { code: "first_publication_package_metadata_apply_permit_invalid" },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });
});
