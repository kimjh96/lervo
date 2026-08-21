import { canonicalJson } from "./release-artifact-manifest.mjs";
import { validateReleasePublicationAuthorization } from
  "./release-publication-authorization.mjs";
import {
  trustedPublisherEnvironment,
  trustedPublisherWorkflow,
} from "./trusted-publisher-readiness.mjs";

export const firstPublicationApprovalMaximumLifetimeMs = 24 * 60 * 60 * 1000;
export const firstPublicationRegistryObservationLifetimeMs = 10 * 60 * 1000;
const approvalIdPattern = /^apr_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const requiredConfirmations = [
  "license_approved",
  "one_time_direct_publish_approved",
  "package_name_availability_confirmed",
  "scope_control_confirmed",
  "stage_only_transition_required",
];

export const firstPublicationExecution = {
  mode: "manual_interactive_once",
  requiresFreshPackageAbsenceCheck: true,
  requiresTwoFactorAuthentication: true,
  reusable: false,
};

export const firstPublicationTransition = {
  nextMode: "trusted_publisher_stage_only",
  workflow: trustedPublisherWorkflow,
  environment: trustedPublisherEnvironment,
  permission: "createStagedPackage",
  directPublishAfterBootstrap: "forbidden",
};

export class FirstPublicationBootstrapError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FirstPublicationBootstrapError";
    this.code = code;
  }
}

function fail(code = "first_publication_bootstrap_input_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI 최초 게시 bootstrap 입력이 올바르지 않습니다.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    fail();
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
}

function validateApproval(approval, authorization, observedAt) {
  if (
    !exactKeys(approval, [
      "schemaVersion", "approvalId", "decision", "approvedAt", "expiresAt",
      "approver", "target", "confirmations",
    ]) ||
    approval.schemaVersion !== 1 ||
    !approvalIdPattern.test(approval.approvalId ?? "") ||
    approval.decision !== "approve_first_publication" ||
    !exactKeys(approval.approver, ["kind", "id"]) ||
    approval.approver.kind !== "user" ||
    typeof approval.approver.id !== "string" ||
    approval.approver.id.length < 1 || approval.approver.id.length > 150 ||
    !exactKeys(approval.target, [
      "package", "repository", "license", "scopeOwner", "publicationAuthorizationDigest",
    ]) ||
    approval.target.package !== "@lervo/cli" ||
    typeof approval.target.license !== "string" ||
    approval.target.license.length < 1 || approval.target.license.length > 128 ||
    approval.target.license === "UNLICENSED" ||
    !exactKeys(approval.target.scopeOwner, ["kind", "name"]) ||
    !["organization", "user"].includes(approval.target.scopeOwner.kind) ||
    approval.target.scopeOwner.name !== "lervo" ||
    approval.target.publicationAuthorizationDigest !== authorization.authorizationDigest ||
    !Array.isArray(approval.confirmations) ||
    canonicalJson([...approval.confirmations].sort()) !== canonicalJson(requiredConfirmations)
  ) fail("first_publication_approval_invalid");
  const approvedAt = timestamp(approval.approvedAt);
  const expiresAt = timestamp(approval.expiresAt);
  if (
    approvedAt > observedAt || expiresAt <= observedAt ||
    expiresAt - approvedAt > firstPublicationApprovalMaximumLifetimeMs
  ) fail("first_publication_approval_expired");
}

export function validateFirstPublicationApproval({
  approval,
  publicationAuthorization,
  checkedAt,
}) {
  const authorization = validateReleasePublicationAuthorization(publicationAuthorization);
  validateApproval(approval, authorization, timestamp(checkedAt));
  return approval;
}
