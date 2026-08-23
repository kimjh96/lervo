import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { canonicalDigest, canonicalJson, sha256 } from
  "./release-artifact-manifest.mjs";
import { validateFirstPublicationMetadataPreview } from
  "./first-publication-metadata-preview.mjs";
import { createFirstPublicationPackageMetadataOutput } from
  "./first-publication-package-metadata-output.mjs";

const sideEffects = Object.freeze({
  metadata: "not_changed",
  releaseManifest: "not_regenerated",
  approval: "not_created",
  activation: "not_changed",
  publication: "not_attempted",
});

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_package_metadata_candidate_invalid",
    "The CLI first-publication package metadata candidate is invalid.",
  );
}

function candidateBody({ packageManifest, releaseManifest, decision, preview, sourceSnapshots }) {
  try {
    validateFirstPublicationMetadataPreview(preview, {
      packageManifest,
      releaseManifest,
      decision,
    });
  } catch {
    fail();
  }
  const packageSnapshot = sourceSnapshots?.packageManifest;
  if (
    !Buffer.isBuffer(packageSnapshot?.contents) ||
    packageSnapshot.byteCount !== packageSnapshot.contents.length ||
    packageSnapshot.sha256 !== sha256(packageSnapshot.contents) ||
    preview.sources.packageManifestDigest !== canonicalDigest(packageManifest)
  ) fail();
  const generated = createFirstPublicationPackageMetadataOutput({
    packageManifest,
    packageSourceContents: packageSnapshot.contents,
    preview,
  });
  const body = {
    schemaVersion: 1,
    status: "review_required",
    writesAllowed: false,
    target: {
      document: "package_manifest",
      relativePath: "apps/cli/package.json",
      package: preview.target.package,
      version: preview.target.version,
    },
    sources: {
      packageSourceSha256: packageSnapshot.sha256,
      packageSourceByteCount: packageSnapshot.byteCount,
      packageManifestDigest: preview.sources.packageManifestDigest,
      releaseManifestDigest: preview.sources.releaseManifestDigest,
      metadataDecisionDigest: preview.sources.metadataDecisionDigest,
      metadataPreviewDigest: preview.metadataPreviewDigest,
    },
    changes: structuredClone(preview.packageManifestChanges),
    output: generated.output,
    verification: {
      ...generated.verification,
      releaseManifestDirectPatch: "forbidden",
    },
    sideEffects: structuredClone(sideEffects),
  };
  return {
    candidate: { ...body, candidateDigest: canonicalDigest(body) },
    outputBytes: generated.outputBytes,
  };
}

export function createFirstPublicationPackageMetadataCandidate(sources) {
  return candidateBody(sources);
}

export function validateFirstPublicationPackageMetadataCandidate(result, sources) {
  let expected;
  try {
    expected = createFirstPublicationPackageMetadataCandidate(sources);
  } catch {
    fail();
  }
  if (
    canonicalJson(result?.candidate) !== canonicalJson(expected.candidate) ||
    !Buffer.isBuffer(result?.outputBytes) ||
    !result.outputBytes.equals(expected.outputBytes)
  ) fail();
  return result;
}
