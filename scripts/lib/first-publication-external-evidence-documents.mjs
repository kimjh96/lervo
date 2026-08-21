import {
  FirstPublicationBootstrapError,
  firstPublicationApprovalMaximumLifetimeMs,
} from "./first-publication-bootstrap.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

const licenseApprovalIdPattern = /^lic_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const scopeConfirmationIdPattern = /^scp_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function fail(code) {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI 최초 게시 외부 요구사항 증거 문서가 올바르지 않습니다.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

export function firstPublicationEvidenceTimestamp(value, code) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  ) fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail(code);
  return milliseconds;
}

function validActor(actor) {
  return exactKeys(actor, ["kind", "id"]) && actor.kind === "user" &&
    typeof actor.id === "string" && actor.id.length > 0 && actor.id.length <= 150;
}

function validPostTarget(documentTarget, postApplyReport) {
  let repository;
  try {
    repository = validateReadinessRepository(documentTarget?.repository);
  } catch {
    return false;
  }
  return documentTarget.package === postApplyReport?.target?.package &&
    repository === postApplyReport.target.repository &&
    documentTarget.license === postApplyReport.target.license &&
    documentTarget.postApplyReportDigest === postApplyReport.reportDigest;
}

export function validateFirstPublicationLicenseApproval(
  approval,
  postApplyReport,
  checkedAt,
) {
  const code = "first_publication_external_evidence_license_approval_invalid";
  const approvedAt = firstPublicationEvidenceTimestamp(approval?.approvedAt, code);
  const checkedAtMs = firstPublicationEvidenceTimestamp(checkedAt, code);
  if (
    !exactKeys(approval, [
      "schemaVersion", "evidenceType", "approvalId", "decision", "approvedAt",
      "approver", "target", "basis",
    ]) || approval.schemaVersion !== 1 ||
    approval.evidenceType !== "first_publication_license_approval" ||
    !licenseApprovalIdPattern.test(approval.approvalId ?? "") ||
    approval.decision !== "approve_public_distribution_license" ||
    approval.basis !== "operator_attestation" || !validActor(approval.approver) ||
    !exactKeys(approval.target, [
      "package", "repository", "license", "postApplyReportDigest",
    ]) || !digestPattern.test(approval.target.postApplyReportDigest ?? "") ||
    !validPostTarget(approval.target, postApplyReport) || approvedAt > checkedAtMs
  ) fail(code);
  return approval;
}

export function validateFirstPublicationScopeControlConfirmation(
  confirmation,
  postApplyReport,
  checkedAt,
) {
  const code = "first_publication_external_evidence_scope_confirmation_invalid";
  const confirmedAt = firstPublicationEvidenceTimestamp(confirmation?.confirmedAt, code);
  const expiresAt = firstPublicationEvidenceTimestamp(confirmation?.expiresAt, code);
  const checkedAtMs = firstPublicationEvidenceTimestamp(checkedAt, code);
  if (
    !exactKeys(confirmation, [
      "schemaVersion", "evidenceType", "confirmationId", "decision", "confirmedAt",
      "expiresAt", "confirmer", "target", "basis",
    ]) || confirmation.schemaVersion !== 1 ||
    confirmation.evidenceType !== "first_publication_npm_scope_control_confirmation" ||
    !scopeConfirmationIdPattern.test(confirmation.confirmationId ?? "") ||
    confirmation.decision !== "confirm_npm_scope_control" ||
    confirmation.basis !== "operator_attestation" || !validActor(confirmation.confirmer) ||
    !exactKeys(confirmation.target, ["package", "scopeOwner", "postApplyReportDigest"]) ||
    confirmation.target.package !== postApplyReport?.target?.package ||
    !exactKeys(confirmation.target.scopeOwner, ["kind", "name"]) ||
    !["organization", "user"].includes(confirmation.target.scopeOwner.kind) ||
    confirmation.target.scopeOwner.name !== "lervo" ||
    confirmation.target.postApplyReportDigest !== postApplyReport.reportDigest ||
    !digestPattern.test(confirmation.target.postApplyReportDigest ?? "") ||
    confirmedAt > checkedAtMs || expiresAt <= checkedAtMs ||
    expiresAt - confirmedAt > firstPublicationApprovalMaximumLifetimeMs
  ) fail(code);
  return confirmation;
}
