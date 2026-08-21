import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationMetadataDecision } from
  "./first-publication-metadata-decision.mjs";
import { validateFirstPublicationPackageMetadataCandidate } from
  "./first-publication-package-metadata-candidate.mjs";
import { canonicalDigest, canonicalJson, sha256 } from "./release-artifact-manifest.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;

const sideEffects = Object.freeze({
  metadata: "not_changed",
  releaseManifest: "not_regenerated",
  approval: "not_created",
  activation: "not_changed",
  publication: "not_attempted",
});

function fail(code = "first_publication_package_metadata_apply_permit_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI 최초 게시 package metadata 적용 허가가 올바르지 않습니다.",
  );
}

function validateReview(review, candidate) {
  if (
    review === null || typeof review !== "object" || Array.isArray(review) ||
    canonicalJson(Object.keys(review).sort()) !== canonicalJson([
      "actorKind",
      "candidateDigest",
      "confirmation",
      "outputSha256",
      "packageSourceSha256",
    ]) ||
    review?.confirmation !== "reviewed_exact_candidate" ||
    review.actorKind !== "human_operator" ||
    !digestPattern.test(review.candidateDigest ?? "") ||
    !digestPattern.test(review.packageSourceSha256 ?? "") ||
    !digestPattern.test(review.outputSha256 ?? "") ||
    review.candidateDigest !== candidate.candidateDigest ||
    review.packageSourceSha256 !== candidate.sources.packageSourceSha256 ||
    review.outputSha256 !== candidate.output.sha256
  ) fail("first_publication_package_metadata_apply_review_invalid");
}

function permitBody({ candidateResult, candidateSources, decision, review }) {
  validateFirstPublicationMetadataDecision(decision);
  try {
    validateFirstPublicationPackageMetadataCandidate(candidateResult, candidateSources);
  } catch {
    fail();
  }
  const candidate = candidateResult?.candidate;
  const outputBytes = candidateResult?.outputBytes;
  if (
    candidate?.status !== "review_required" ||
    candidate.writesAllowed !== false ||
    !Buffer.isBuffer(outputBytes) ||
    !digestPattern.test(candidate.candidateDigest ?? "") ||
    !digestPattern.test(candidate.sources?.packageSourceSha256 ?? "") ||
    !digestPattern.test(candidate.output?.sha256 ?? "") ||
    !Number.isSafeInteger(candidate.sources?.packageSourceByteCount) ||
    candidate.sources.packageSourceByteCount < 1 ||
    !Number.isSafeInteger(candidate.output?.byteCount) ||
    outputBytes.length !== candidate.output.byteCount ||
    sha256(outputBytes) !== candidate.output.sha256 ||
    candidate.target?.package !== decision.target.package ||
    candidate.sources?.metadataDecisionDigest !== decision.metadataDecisionDigest
  ) fail();
  validateReview(review, candidate);
  return {
    schemaVersion: 1,
    status: "apply_permitted",
    permitType: "first_publication_package_metadata_apply",
    target: structuredClone(candidate.target),
    selection: {
      repository: decision.target.repository,
      license: decision.target.license,
      scopeOwner: structuredClone(decision.target.scopeOwner),
    },
    binding: {
      candidateDigest: candidate.candidateDigest,
      packageSourceSha256: candidate.sources.packageSourceSha256,
      packageSourceByteCount: candidate.sources.packageSourceByteCount,
      outputSha256: candidate.output.sha256,
      outputByteCount: candidate.output.byteCount,
    },
    review: {
      actorKind: "human_operator",
      decision: "approve_exact_package_metadata_apply",
      confirmation: "reviewed_exact_candidate",
    },
    authority: {
      packageManifest: "replace_if_source_matches",
      releaseManifest: "regenerate_after_package_update",
      directReleaseManifestPatch: "forbidden",
      scope: "local_package_metadata_only",
    },
    replayProtection: "source_compare_and_swap",
    sideEffects: structuredClone(sideEffects),
  };
}

export function createFirstPublicationPackageMetadataApplyPermit(input) {
  const body = permitBody(input);
  return { ...body, permitDigest: canonicalDigest(body) };
}

export function validateFirstPublicationPackageMetadataApplyPermit(permit, input) {
  let expected;
  try {
    expected = createFirstPublicationPackageMetadataApplyPermit(input);
  } catch {
    fail();
  }
  if (canonicalJson(permit) !== canonicalJson(expected)) fail();
  return permit;
}
