import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  cliEnglishDescription,
  createFirstPublicationMetadataDecision,
  validateFirstPublicationMetadataDecision,
} from "../first-publication-metadata-decision.mjs";
import {
  createFirstPublicationMetadataPreview,
  validateFirstPublicationMetadataPreview,
} from "../first-publication-metadata-preview.mjs";
import { canonicalDigest } from "../../../../shared/release-artifact-manifest.mjs";
import { npmPublicRegistry } from "../../../lib/release-publication-authorization.mjs";
import {
  activationRepository,
  currentActivationSources,
  replaceActivationReleaseArtifact,
} from "../../test/fixtures/first-publication-activation.mjs";

const license = "Apache-2.0";
const repositoryUrl = `git+https://github.com/${activationRepository}.git`;

function decision(overrides = {}) {
  return createFirstPublicationMetadataDecision({
    repository: activationRepository,
    license,
    scopeOwnerKind: "organization",
    scopeOwnerName: "lervo",
    ...overrides,
  });
}

async function alignedSources() {
  const sources = await currentActivationSources();
  sources.packageManifest = {
    ...sources.packageManifest,
    description: cliEnglishDescription,
    license,
    repository: { type: "git", url: repositoryUrl },
    publishConfig: { access: "public", registry: npmPublicRegistry, provenance: true },
  };
  sources.releaseManifest = replaceActivationReleaseArtifact(sources.releaseManifest, {
    description: cliEnglishDescription,
    license,
    repository: repositoryUrl,
    registry: npmPublicRegistry,
    provenance: true,
  });
  return sources;
}

describe("first-publication metadata decision and preview", () => {
  it("keeps the metadata selection explicitly non-authorizing", () => {
    const selected = decision();
    assert.equal(selected.authority, "preview_only");
    assert.deepEqual(selected.effect, {
      approval: "not_granted",
      scopeControl: "not_confirmed",
      packageAvailability: "not_observed",
    });
    assert.match(selected.metadataDecisionDigest, /^sha256:[a-f0-9]{64}$/u);
  });

  it("rejects a redigested decision that claims approval authority", () => {
    const forged = structuredClone(decision());
    forged.authority = "approval";
    forged.effect.approval = "granted";
    const { metadataDecisionDigest: _discarded, ...body } = forged;
    forged.metadataDecisionDigest = canonicalDigest(body);
    assert.throws(() => validateFirstPublicationMetadataDecision(forged), {
      code: "first_publication_metadata_decision_invalid",
    });
  });

  it("rejects unresolved, unsafe, or mismatched decision inputs", () => {
    for (const input of [
      { license: "UNLICENSED" },
      { license: "MIT\nmalicious" },
      { repository: "not-a-repository" },
      { scopeOwnerKind: "team" },
      { scopeOwnerName: "other" },
    ]) {
      assert.throws(() => decision(input), {
        code: "first_publication_metadata_decision_invalid",
      });
    }
  });

  it("calculates only the four package metadata changes for the current sources", async () => {
    const preview = createFirstPublicationMetadataPreview({
      ...(await currentActivationSources()),
      decision: decision(),
    });
    assert.equal(preview.status, "changes_required");
    assert.deepEqual(
      preview.packageManifestChanges.map(({ field, currentState }) => ({
        field,
        currentState,
      })),
      [
        { field: "repository", currentState: "missing" },
        { field: "license", currentState: "missing" },
        { field: "publishConfig.registry", currentState: "missing" },
        { field: "publishConfig.provenance", currentState: "missing" },
      ],
    );
    assert.equal(preview.releaseManifestRegeneration.status, "required");
    assert.equal(preview.releaseManifestRegeneration.directPatch, "forbidden");
    assert.equal(preview.sideEffects.metadata, "not_changed");
  });

  it("keeps approval requirements when local metadata already matches", async () => {
    const preview = createFirstPublicationMetadataPreview({
      ...(await alignedSources()),
      decision: decision(),
    });
    assert.equal(preview.status, "no_local_changes");
    assert.deepEqual(preview.packageManifestChanges, []);
    assert.equal(preview.releaseManifestRegeneration.status, "not_required");
    assert.equal(preview.activation, "not_implemented");
    assert.equal(
      preview.remainingRequirements.every(({ status }) => status === "required"),
      true,
    );
  });

  it("marks existing different values without copying them into the preview", async () => {
    const sources = await alignedSources();
    sources.packageManifest = {
      ...sources.packageManifest,
      license: "MIT",
      repository: {
        type: "git",
        url: "git+https://github.com/example/another.git",
      },
    };
    const preview = createFirstPublicationMetadataPreview({ ...sources, decision: decision() });
    assert.deepEqual(
      preview.packageManifestChanges.slice(0, 2).map((change) => ({
        field: change.field,
        currentState: change.currentState,
      })),
      [
        { field: "repository", currentState: "different" },
        { field: "license", currentState: "different" },
      ],
    );
    assert.equal(JSON.stringify(preview).includes("example/another"), false);
    assert.equal(JSON.stringify(preview).includes('"MIT"'), false);
  });

  it("refuses to preview unrelated package identity repairs", async () => {
    const sources = await currentActivationSources();
    sources.packageManifest = { ...sources.packageManifest, name: "@other/cli" };
    assert.throws(
      () => createFirstPublicationMetadataPreview({ ...sources, decision: decision() }),
      { code: "first_publication_metadata_preview_source_ineligible" },
    );
  });

  it("rejects a redigested activation or approval claim", async () => {
    const sources = { ...(await currentActivationSources()), decision: decision() };
    const forged = structuredClone(createFirstPublicationMetadataPreview(sources));
    forged.activation = "armed";
    forged.remainingRequirements = [];
    const { metadataPreviewDigest: _discarded, ...body } = forged;
    forged.metadataPreviewDigest = canonicalDigest(body);
    assert.throws(() => validateFirstPublicationMetadataPreview(forged, sources), {
      code: "first_publication_metadata_preview_invalid",
    });
  });
});
