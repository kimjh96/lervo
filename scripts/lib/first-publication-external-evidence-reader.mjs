import {
  firstPublicationApprovalMaximumLifetimeMs,
  firstPublicationRegistryObservationLifetimeMs,
  FirstPublicationBootstrapError,
} from "./first-publication-bootstrap.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const sourceDigestPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function invalid() {
  throw new FirstPublicationBootstrapError(
    "first_publication_external_evidence_report_invalid",
    "The CLI first-publication external-requirements evidence report is invalid.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  ) invalid();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) invalid();
  return milliseconds;
}

function validTarget(target) {
  try {
    validateReadinessRepository(target?.repository);
  } catch {
    return false;
  }
  return exactKeys(target, [
    "package", "version", "repository", "license", "registry", "scopeOwner",
  ]) && target.package === "@lervo/cli" && /^\d+\.\d+\.\d+$/u.test(target.version ?? "") &&
    typeof target.license === "string" && target.license.length > 0 &&
    target.license.length <= 128 && target.license !== "UNLICENSED" &&
    target.registry === npmPublicRegistry &&
    exactKeys(target.scopeOwner, ["kind", "name"]) &&
    ["organization", "user"].includes(target.scopeOwner.kind) &&
    target.scopeOwner.name === "lervo";
}

function validEvidence(evidence, checkedAt) {
  const license = evidence?.licenseApproval;
  const npm = evidence?.publicPackageAvailability;
  const scope = evidence?.scopeControlConfirmation;
  const approval = evidence?.firstPublicationApproval;
  if (
    !exactKeys(evidence, [
      "licenseApproval", "publicPackageAvailability", "scopeControlConfirmation",
      "firstPublicationApproval",
    ]) ||
    !exactKeys(license, ["approvalId", "approvalDigest", "approvedAt", "basis"]) ||
    !/^lic_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(license.approvalId ?? "") ||
    !digestPattern.test(license.approvalDigest ?? "") ||
    license.basis !== "operator_attestation" || timestamp(license.approvedAt) > checkedAt ||
    !exactKeys(npm, ["state", "observationDigest", "observedAt", "validUntil"]) ||
    npm.state !== "public_package_not_found" ||
    !digestPattern.test(npm.observationDigest ?? "") || timestamp(npm.observedAt) !== checkedAt ||
    timestamp(npm.validUntil) <= checkedAt ||
    timestamp(npm.validUntil) - checkedAt > firstPublicationRegistryObservationLifetimeMs ||
    !exactKeys(scope, [
      "confirmationId", "confirmationDigest", "confirmedAt", "expiresAt", "basis",
    ]) || !/^scp_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(scope.confirmationId ?? "") ||
    !digestPattern.test(scope.confirmationDigest ?? "") ||
    scope.basis !== "operator_attestation" || timestamp(scope.confirmedAt) > checkedAt ||
    timestamp(scope.expiresAt) <= checkedAt ||
    timestamp(scope.expiresAt) - timestamp(scope.confirmedAt) >
      firstPublicationApprovalMaximumLifetimeMs ||
    !exactKeys(approval, ["approvalId", "approvalDigest", "approvedAt", "expiresAt"]) ||
    !/^apr_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(approval.approvalId ?? "") ||
    !digestPattern.test(approval.approvalDigest ?? "") ||
    timestamp(approval.approvedAt) > checkedAt || timestamp(approval.expiresAt) <= checkedAt ||
    timestamp(approval.expiresAt) - timestamp(approval.approvedAt) >
      firstPublicationApprovalMaximumLifetimeMs
  ) invalid();
  return { npm, scope, approval };
}

export function validateFirstPublicationExternalEvidenceReportDocument(report) {
  if (report === null || typeof report !== "object" || Array.isArray(report)) invalid();
  const { evidenceReportDigest, ...body } = report;
  const checkedAt = timestamp(report.validity?.checkedAt);
  const validUntil = timestamp(report.validity?.validUntil);
  const expiry = validEvidence(report.evidence, checkedAt);
  if (
    !exactKeys(report, [
      "schemaVersion", "status", "activation", "arming", "target", "validity",
      "localEvidence", "release", "evidence", "requirements", "limitations",
      "sideEffects", "evidenceReportDigest",
    ]) || report.schemaVersion !== 1 || report.status !== "evidence_bound" ||
    report.activation !== "not_implemented" || report.arming !== "not_armed" ||
    !validTarget(report.target) ||
    !exactKeys(report.validity, ["checkedAt", "validUntil"]) ||
    validUntil <= checkedAt || validUntil > timestamp(expiry.npm.validUntil) ||
    validUntil > timestamp(expiry.scope.expiresAt) ||
    validUntil > timestamp(expiry.approval.expiresAt) ||
    !exactKeys(report.localEvidence, ["postApplyReportDigest", "receiptDigest"]) ||
    !digestPattern.test(report.localEvidence.postApplyReportDigest ?? "") ||
    !digestPattern.test(report.localEvidence.receiptDigest ?? "") ||
    !exactKeys(report.release, [
      "publicationAuthorizationDigest", "artifactSha256", "sourceDigest",
    ]) || !digestPattern.test(report.release.publicationAuthorizationDigest ?? "") ||
    !sha256Pattern.test(report.release.artifactSha256 ?? "") ||
    !sourceDigestPattern.test(report.release.sourceDigest ?? "") ||
    canonicalJson(report.requirements) !== canonicalJson([
      { id: "license_approval", status: "bound" },
      { id: "public_package_availability", status: "bound" },
      { id: "scope_control_confirmation", status: "bound" },
      { id: "first_publication_approval", status: "bound" },
    ]) || canonicalJson(report.limitations) !== canonicalJson({
      receiptAuthenticity: "not_verified",
      actorIdentity: "not_authenticated",
      scopeControlAuthority: "not_registry_verified",
      privatePackageAbsence: "not_observed",
      releaseArtifact: "not_revalidated",
    }) || canonicalJson(report.sideEffects) !== canonicalJson({
      files: "not_changed",
      onlineObservation: "npm_public_registry_read_only",
      approval: "not_created",
      activation: "not_changed",
      publication: "not_attempted",
    }) || !digestPattern.test(evidenceReportDigest ?? "") ||
    evidenceReportDigest !== canonicalDigest(body)
  ) invalid();
  return report;
}
