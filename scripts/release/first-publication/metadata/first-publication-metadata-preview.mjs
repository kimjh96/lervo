import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import { inspectFirstPublicationActivationLocalMetadata } from "../shared/first-publication-activation-local-policy.mjs";
import {
  canonicalDigest,
  canonicalJson,
  validateReleaseArtifactManifest,
} from "../../../shared/release-artifact-manifest.mjs";
import { validateFirstPublicationMetadataDecision } from "./first-publication-metadata-decision.mjs";
import { inspectFirstPublicationMetadataPatch } from "./first-publication-metadata-patch-policy.mjs";
import { npmPublicRegistry } from "../../lib/release-publication-authorization.mjs";

const remainingRequirements = Object.freeze(
  [
    { id: "license_approval", status: "required" },
    { id: "public_package_availability", status: "required" },
    { id: "scope_control_confirmation", status: "required" },
    { id: "first_publication_approval", status: "required" },
  ].map(Object.freeze),
);

const sideEffects = Object.freeze({
  onlineObservation: "not_run",
  metadata: "not_changed",
  releaseManifest: "not_regenerated",
  approval: "not_created",
  activation: "not_changed",
  publication: "not_attempted",
});

function fail(code = "first_publication_metadata_preview_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication metadata-change preview is invalid.",
  );
}

function previewBody({ packageManifest, releaseManifest, decision }) {
  if (
    packageManifest === null ||
    typeof packageManifest !== "object" ||
    Array.isArray(packageManifest)
  )
    fail();
  try {
    validateReleaseArtifactManifest(releaseManifest);
    validateFirstPublicationMetadataDecision(decision);
  } catch {
    fail();
  }
  const current = inspectFirstPublicationActivationLocalMetadata({
    packageManifest,
    releaseManifest,
  });
  if (current.localChecks[0].status !== "ready") {
    fail("first_publication_metadata_preview_source_ineligible");
  }
  const patch = inspectFirstPublicationMetadataPatch({
    packageManifest,
    releaseManifest,
    decision,
  });
  return {
    schemaVersion: 1,
    status:
      patch.packageManifestChanges.length === 0 &&
      patch.releaseManifestRegeneration.status === "not_required"
        ? "no_local_changes"
        : "changes_required",
    activation: "not_implemented",
    advisoryOnly: true,
    target: {
      package: "@lervo/cli",
      version: releaseManifest.artifact.version,
      description: decision.target.description,
      repository: decision.target.repository,
      license: decision.target.license,
      scopeOwner: structuredClone(decision.target.scopeOwner),
      registry: npmPublicRegistry,
    },
    sources: {
      packageManifestDigest: canonicalDigest(packageManifest),
      releaseManifestDigest: canonicalDigest(releaseManifest),
      metadataDecisionDigest: decision.metadataDecisionDigest,
    },
    packageManifestChanges: patch.packageManifestChanges,
    releaseManifestRegeneration: patch.releaseManifestRegeneration,
    remainingRequirements: structuredClone(remainingRequirements),
    sideEffects: structuredClone(sideEffects),
  };
}

export function createFirstPublicationMetadataPreview(sources) {
  const body = previewBody(sources);
  return { ...body, metadataPreviewDigest: canonicalDigest(body) };
}

export function validateFirstPublicationMetadataPreview(preview, sources) {
  let expected;
  try {
    expected = createFirstPublicationMetadataPreview(sources);
  } catch {
    fail();
  }
  if (canonicalJson(preview) !== canonicalJson(expected)) fail();
  return preview;
}
