import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import { canonicalDigest, canonicalJson } from "../../../shared/release-artifact-manifest.mjs";

const fileCoordinates = Object.freeze([
  { id: "packageManifest", relativePath: "apps/cli/package.json" },
  { id: "releaseManifest", relativePath: "apps/cli/release-artifact-manifest.json" },
  { id: "releaseSbom", relativePath: "apps/cli/release-sbom.cdx.json" },
]);

const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_package_metadata_apply_receipt_invalid",
    "The CLI first-publication package metadata apply receipt is invalid.",
  );
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function validFileBinding(binding, coordinate) {
  return (
    exactKeys(binding, ["id", "relativePath", "before", "after"]) &&
    binding.id === coordinate.id &&
    binding.relativePath === coordinate.relativePath &&
    [binding.before, binding.after].every(
      (side) =>
        exactKeys(side, ["byteCount", "sha256"]) &&
        Number.isSafeInteger(side.byteCount) &&
        side.byteCount > 0 &&
        digestPattern.test(side.sha256),
    ) &&
    binding.before.sha256 !== binding.after.sha256
  );
}

function receiptBody(plan) {
  return {
    schemaVersion: 1,
    status: "applied",
    transactionType: plan.transactionType,
    planDigest: plan.planDigest,
    permitDigest: plan.permitDigest,
    candidateDigest: plan.candidateDigest,
    files: structuredClone(plan.files),
    transaction: {
      journal: "removed",
      rollback: "not_required",
      recovery: "not_required",
    },
    effects: {
      packageMetadata: "changed",
      releaseManifest: "regenerated",
      releaseSbom: "regenerated",
      approval: "not_changed",
      activation: "not_changed",
      publication: "not_attempted",
    },
  };
}

export function createFirstPublicationPackageMetadataApplyReceipt(plan) {
  const body = receiptBody(plan);
  return { ...body, receiptDigest: canonicalDigest(body) };
}

export function validateFirstPublicationPackageMetadataApplyReceiptDocument(receipt) {
  const validFiles =
    Array.isArray(receipt?.files) &&
    receipt.files.length === 3 &&
    receipt.files.every((binding, index) => validFileBinding(binding, fileCoordinates[index]));
  const validTransaction =
    exactKeys(receipt?.transaction, ["journal", "rollback", "recovery"]) &&
    receipt.transaction.journal === "removed" &&
    receipt.transaction.rollback === "not_required" &&
    receipt.transaction.recovery === "not_required";
  const validEffects =
    exactKeys(receipt?.effects, [
      "packageMetadata",
      "releaseManifest",
      "releaseSbom",
      "approval",
      "activation",
      "publication",
    ]) &&
    canonicalJson(receipt.effects) ===
      canonicalJson({
        packageMetadata: "changed",
        releaseManifest: "regenerated",
        releaseSbom: "regenerated",
        approval: "not_changed",
        activation: "not_changed",
        publication: "not_attempted",
      });
  if (
    !exactKeys(receipt, [
      "schemaVersion",
      "status",
      "transactionType",
      "planDigest",
      "permitDigest",
      "candidateDigest",
      "files",
      "transaction",
      "effects",
      "receiptDigest",
    ]) ||
    receipt.schemaVersion !== 1 ||
    receipt.status !== "applied" ||
    receipt.transactionType !== "first_publication_package_metadata_apply" ||
    ![
      receipt.planDigest,
      receipt.permitDigest,
      receipt.candidateDigest,
      receipt.receiptDigest,
    ].every((digest) => digestPattern.test(digest ?? "")) ||
    !validFiles ||
    !validTransaction ||
    !validEffects
  )
    fail();
  const { receiptDigest, ...body } = receipt;
  if (receiptDigest !== canonicalDigest(body)) fail();
  return receipt;
}

export function validateFirstPublicationPackageMetadataApplyReceipt(receipt, plan) {
  try {
    validateFirstPublicationPackageMetadataApplyReceiptDocument(receipt);
    if (
      canonicalJson(receipt) !==
      canonicalJson(createFirstPublicationPackageMetadataApplyReceipt(plan))
    ) {
      fail();
    }
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
  return receipt;
}
