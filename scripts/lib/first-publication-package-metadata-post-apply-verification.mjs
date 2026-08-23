import { validateCliReleaseSbom } from "./cli-release-sbom.mjs";
import { inspectFirstPublicationActivationLocalMetadata } from
  "./first-publication-activation-local-policy.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationPackageMetadataApplyReceiptDocument } from
  "./first-publication-package-metadata-apply-receipt.mjs";
import {
  canonicalDigest,
  canonicalJson,
  sha256,
  validateReleaseArtifactManifest,
} from "./release-artifact-manifest.mjs";

const externalRequirements = Object.freeze([
  { id: "license_approval", status: "required", reason: "explicit_approval_required" },
  { id: "public_package_availability", status: "required", reason: "online_observation_required" },
  { id: "scope_control_confirmation", status: "required", reason: "scope_owner_confirmation_required" },
  { id: "first_publication_approval", status: "required", reason: "explicit_approval_required" },
].map(Object.freeze));

const sideEffects = Object.freeze({
  files: "not_changed",
  onlineObservation: "not_run",
  approval: "not_created",
  activation: "not_changed",
  publication: "not_attempted",
});

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

function assertReceiptOutputs(receipt, snapshots) {
  for (const binding of receipt.files) {
    const snapshot = snapshots?.[binding.id];
    if (
      !Buffer.isBuffer(snapshot?.contents) ||
      snapshot.byteCount !== snapshot.contents.length ||
      snapshot.sha256 !== sha256(snapshot.contents) ||
      snapshot.byteCount !== binding.after.byteCount ||
      snapshot.sha256 !== binding.after.sha256
    ) {
      fail(
        "first_publication_package_metadata_post_apply_source_mismatch",
        "The CLI first-publication package metadata apply result differs from the receipt.",
      );
    }
  }
}

function assertReleaseConsistency(input) {
  try {
    validateReleaseArtifactManifest(input.releaseManifest);
    validateReleaseArtifactManifest(input.generatedReleaseManifest);
    if (canonicalJson(input.releaseManifest) !== canonicalJson(input.generatedReleaseManifest)) {
      throw new Error("release manifest mismatch");
    }
    validateCliReleaseSbom(input.releaseSbom, input.releaseManifest, input.lockfile);
  } catch {
    fail(
      "first_publication_package_metadata_post_apply_release_inconsistent",
      "The CLI first-publication package metadata does not match the release sources.",
    );
  }
}

function reportBody(input) {
  validateFirstPublicationPackageMetadataApplyReceiptDocument(input.receipt);
  if (input.transactionState?.status !== "clear") {
    fail(
      "first_publication_package_metadata_post_apply_transaction_pending",
      "The interrupted CLI first-publication package metadata transaction must be recovered first.",
    );
  }
  assertReceiptOutputs(input.receipt, input.sourceSnapshots);
  assertReleaseConsistency(input);
  const local = inspectFirstPublicationActivationLocalMetadata(input);
  if (local.localStatus !== "ready") {
    fail(
      "first_publication_package_metadata_post_apply_local_metadata_incomplete",
      "Local blockers remain in the CLI first-publication package metadata.",
    );
  }
  return {
    schemaVersion: 1,
    status: "verified",
    activation: "not_implemented",
    target: local.target,
    receipt: {
      receiptDigest: input.receipt.receiptDigest,
      planDigest: input.receipt.planDigest,
      permitDigest: input.receipt.permitDigest,
      candidateDigest: input.receipt.candidateDigest,
    },
    sources: {
      packageManifestSha256: input.sourceSnapshots.packageManifest.sha256,
      releaseManifestSha256: input.sourceSnapshots.releaseManifest.sha256,
      releaseSbomSha256: input.sourceSnapshots.releaseSbom.sha256,
      lockfileSha256: input.sourceSnapshots.lockfile.sha256,
    },
    localStatus: "ready",
    localChecks: local.localChecks,
    verificationChecks: [
      { id: "transaction_state", status: "ready" },
      { id: "receipt_outputs", status: "ready" },
      { id: "release_manifest_reproduction", status: "ready" },
      { id: "release_sbom_consistency", status: "ready" },
    ],
    externalRequirements: structuredClone(externalRequirements),
    limitations: {
      receiptAuthenticity: "not_verified",
      externalState: "not_observed",
    },
    sideEffects: structuredClone(sideEffects),
  };
}

export function createFirstPublicationPackageMetadataPostApplyReport(input) {
  const body = reportBody(input);
  return { ...body, reportDigest: canonicalDigest(body) };
}

export function validateFirstPublicationPackageMetadataPostApplyReport(report, input) {
  let expected;
  try {
    expected = createFirstPublicationPackageMetadataPostApplyReport(input);
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail(
      "first_publication_package_metadata_post_apply_report_invalid",
      "The CLI first-publication package metadata post-apply verification report is invalid.",
    );
  }
  if (canonicalJson(report) !== canonicalJson(expected)) {
    fail(
      "first_publication_package_metadata_post_apply_report_invalid",
      "The CLI first-publication package metadata post-apply verification report is invalid.",
    );
  }
  return report;
}
