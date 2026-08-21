import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import {
  FirstPublicationBootstrapError,
  firstPublicationExecution,
  firstPublicationRegistryObservationLifetimeMs,
  firstPublicationTransition,
} from "./first-publication-bootstrap.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const sha1Pattern = /^[a-f0-9]{40}$/u;
const sha512IntegrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const sourceDigestPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const semanticVersionPattern = /^\d+\.\d+\.\d+$/u;

function invalid() {
  throw new FirstPublicationBootstrapError(
    "first_publication_bootstrap_invalid",
    "CLI 최초 게시 bootstrap 입력이 올바르지 않습니다.",
  );
}

function unsupported() {
  throw new FirstPublicationBootstrapError(
    "first_publication_bootstrap_schema_unsupported",
    "지원하지 않는 CLI 최초 게시 bootstrap 형식입니다.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    invalid();
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) invalid();
  return milliseconds;
}

function bootstrapBody(bootstrap) {
  return {
    schemaVersion: bootstrap.schemaVersion,
    status: bootstrap.status,
    target: bootstrap.target,
    identity: bootstrap.identity,
    release: bootstrap.release,
    evidence: bootstrap.evidence,
    registryObservation: bootstrap.registryObservation,
    execution: bootstrap.execution,
    transition: bootstrap.transition,
  };
}

export function validateFirstPublicationBootstrapAuthorization(bootstrap) {
  if (bootstrap === null || typeof bootstrap !== "object" || Array.isArray(bootstrap)) invalid();
  if (bootstrap.schemaVersion !== 2) unsupported();
  const observedAt = timestamp(bootstrap.registryObservation?.observedAt);
  const validUntil = timestamp(bootstrap.registryObservation?.validUntil);
  const evidenceCheckedAt = timestamp(bootstrap.evidence?.checkedAt);
  const evidenceValidUntil = timestamp(bootstrap.evidence?.validUntil);
  const body = bootstrapBody(bootstrap);
  if (
    !exactKeys(bootstrap, [...Object.keys(body), "bootstrapDigest"]) ||
    bootstrap.status !== "bootstrap_authorized" ||
    !digestPattern.test(bootstrap.bootstrapDigest ?? "") ||
    bootstrap.bootstrapDigest !== canonicalDigest(body) ||
    !exactKeys(bootstrap.target, ["registry", "package", "version", "distTag", "access"]) ||
    bootstrap.target.registry !== npmPublicRegistry || bootstrap.target.package !== "@lervo/cli" ||
    !semanticVersionPattern.test(bootstrap.target.version ?? "") ||
    !["latest", "next"].includes(bootstrap.target.distTag) || bootstrap.target.access !== "public" ||
    !exactKeys(bootstrap.identity, ["repository", "license", "scopeOwner"]) ||
    typeof bootstrap.identity.license !== "string" || bootstrap.identity.license.length < 1 ||
    bootstrap.identity.license.length > 128 || bootstrap.identity.license === "UNLICENSED" ||
    !exactKeys(bootstrap.identity.scopeOwner, ["kind", "name"]) ||
    !["organization", "user"].includes(bootstrap.identity.scopeOwner.kind) ||
    bootstrap.identity.scopeOwner.name !== "lervo" ||
    !exactKeys(bootstrap.release, [
      "publicationAuthorizationDigest", "artifact", "tag", "sourceDigest",
    ]) || !digestPattern.test(bootstrap.release.publicationAuthorizationDigest ?? "") ||
    !exactKeys(bootstrap.release.artifact, [
      "file", "sha256", "registryIntegrity", "registryShasum",
    ]) || bootstrap.release.artifact.file !== `lervo-cli-${bootstrap.target.version}.tgz` ||
    !/^[a-f0-9]{64}$/u.test(bootstrap.release.artifact.sha256 ?? "") ||
    !sha512IntegrityPattern.test(bootstrap.release.artifact.registryIntegrity ?? "") ||
    !sha1Pattern.test(bootstrap.release.artifact.registryShasum ?? "") ||
    bootstrap.release.tag !== `v${bootstrap.target.version}` ||
    !sourceDigestPattern.test(bootstrap.release.sourceDigest ?? "") ||
    !exactKeys(bootstrap.evidence, [
      "externalEvidenceReportDigest", "postApplyReportDigest", "receiptDigest",
      "licenseApprovalDigest", "scopeConfirmationDigest", "firstPublicationApprovalDigest",
      "checkedAt", "validUntil",
    ]) ||
    !digestPattern.test(bootstrap.evidence.externalEvidenceReportDigest ?? "") ||
    !digestPattern.test(bootstrap.evidence.postApplyReportDigest ?? "") ||
    !digestPattern.test(bootstrap.evidence.receiptDigest ?? "") ||
    !digestPattern.test(bootstrap.evidence.licenseApprovalDigest ?? "") ||
    !digestPattern.test(bootstrap.evidence.scopeConfirmationDigest ?? "") ||
    !digestPattern.test(bootstrap.evidence.firstPublicationApprovalDigest ?? "") ||
    !exactKeys(bootstrap.registryObservation, ["state", "observedAt", "validUntil"]) ||
    bootstrap.registryObservation.state !== "public_package_not_found" ||
    evidenceCheckedAt > observedAt || evidenceCheckedAt >= evidenceValidUntil ||
    observedAt >= validUntil || observedAt >= evidenceValidUntil ||
    validUntil > evidenceValidUntil ||
    validUntil - observedAt > firstPublicationRegistryObservationLifetimeMs ||
    canonicalJson(bootstrap.execution) !== canonicalJson(firstPublicationExecution) ||
    canonicalJson(bootstrap.transition) !== canonicalJson(firstPublicationTransition)
  ) invalid();
  try {
    validateReadinessRepository(bootstrap.identity.repository);
  } catch {
    invalid();
  }
  return bootstrap;
}
