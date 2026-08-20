import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import {
  npmPublicRegistry,
  validateReleasePublicationAuthorization,
} from "./release-publication-authorization.mjs";
import {
  trustedPublisherEnvironment,
  trustedPublisherWorkflow,
  validateReadinessRepository,
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

function repository(value) {
  try {
    return validateReadinessRepository(value);
  } catch {
    fail();
  }
}

function validateIdentity(manifest, releaseManifest, approval, authorization) {
  const approvedRepository = repository(approval.target.repository);
  const expectedRepository = `git+https://github.com/${approvedRepository}.git`;
  if (
    manifest?.name !== "@lervo/cli" ||
    manifest.version !== authorization.target.version ||
    manifest.private !== false ||
    manifest.license !== approval.target.license ||
    manifest.license === "UNLICENSED" ||
    manifest.repository?.type !== "git" ||
    manifest.repository.url !== expectedRepository ||
    manifest.publishConfig?.access !== "public" ||
    manifest.publishConfig.registry !== npmPublicRegistry ||
    manifest.publishConfig.provenance === false ||
    authorization.release.repository !== approvedRepository ||
    releaseManifest?.artifact?.name !== manifest.name ||
    releaseManifest.artifact.version !== manifest.version ||
    releaseManifest.artifact.license !== manifest.license ||
    releaseManifest.artifact.repository !== expectedRepository ||
    releaseManifest.artifact.registry !== npmPublicRegistry ||
    releaseManifest.artifact.provenance === false ||
    releaseManifest.artifact.private !== false ||
    releaseManifest.artifact.access !== "public"
  ) fail("first_publication_identity_unresolved");
  return approvedRepository;
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

function validatePackageObservation(observation) {
  if (
    observation?.schemaVersion !== 1 ||
    observation.source !== "npm_public_registry" ||
    observation.package !== "@lervo/cli"
  ) fail();
  if (observation.state === "unavailable") {
    fail("first_publication_package_observation_unavailable");
  }
  if (observation.state === "existing") {
    fail("first_publication_package_not_missing");
  }
  if (
    !exactKeys(observation, ["schemaVersion", "source", "state", "package"]) ||
    observation.state !== "not_found" ||
    observation.package !== "@lervo/cli"
  ) fail("first_publication_package_not_missing");
}

export function createFirstPublicationBootstrapAuthorization({
  publicationAuthorization,
  packageManifest,
  releaseManifest,
  approval,
  packageObservation,
  observedAt,
}) {
  const authorization = validateReleasePublicationAuthorization(publicationAuthorization);
  const observedMilliseconds = timestamp(observedAt);
  validateApproval(approval, authorization, observedMilliseconds);
  validatePackageObservation(packageObservation);
  const repository = validateIdentity(
    packageManifest,
    releaseManifest,
    approval,
    authorization,
  );
  const validUntil = new Date(Math.min(
    Date.parse(approval.expiresAt),
    observedMilliseconds + firstPublicationRegistryObservationLifetimeMs,
  )).toISOString();
  const body = {
    schemaVersion: 1,
    status: "bootstrap_authorized",
    target: structuredClone(authorization.target),
    identity: {
      repository,
      license: approval.target.license,
      scopeOwner: structuredClone(approval.target.scopeOwner),
    },
    release: {
      publicationAuthorizationDigest: authorization.authorizationDigest,
      artifact: structuredClone(authorization.artifact),
      tag: authorization.release.tag,
      sourceDigest: authorization.release.sourceDigest,
    },
    approval: {
      approvalId: approval.approvalId,
      approvalDigest: canonicalDigest(approval),
      approvedAt: approval.approvedAt,
      expiresAt: approval.expiresAt,
    },
    registryObservation: {
      state: "public_package_not_found",
      observedAt,
      validUntil,
    },
    execution: structuredClone(firstPublicationExecution),
    transition: structuredClone(firstPublicationTransition),
  };
  return { ...body, bootstrapDigest: canonicalDigest(body) };
}

export function validateFirstPublicationBootstrapLocalInputs({
  publicationAuthorization,
  packageManifest,
  releaseManifest,
  approval,
  checkedAt,
}) {
  const authorization = validateReleasePublicationAuthorization(publicationAuthorization);
  const checkedMilliseconds = timestamp(checkedAt);
  validateApproval(approval, authorization, checkedMilliseconds);
  validateIdentity(packageManifest, releaseManifest, approval, authorization);
  return authorization;
}
