import {
  firstPublicationExecution,
  firstPublicationRegistryObservationLifetimeMs,
  firstPublicationTransition,
  FirstPublicationBootstrapError,
} from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationExternalEvidenceReportDocument } from
  "./first-publication-external-evidence-reader.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import {
  npmPublicRegistry,
  validateReleasePublicationAuthorization,
} from "./release-publication-authorization.mjs";

function fail(code = "first_publication_bootstrap_input_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication bootstrap input is invalid.",
  );
}

function timestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  ) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
}

function validateEvidenceBinding(report, authorization, checkedAt) {
  validateFirstPublicationExternalEvidenceReportDocument(report);
  const target = report.target;
  if (
    target.package !== authorization.target.package ||
    target.version !== authorization.target.version ||
    target.registry !== authorization.target.registry ||
    target.repository !== authorization.release.repository ||
    report.release.publicationAuthorizationDigest !== authorization.authorizationDigest ||
    report.release.artifactSha256 !== authorization.artifact.sha256 ||
    report.release.sourceDigest !== authorization.release.sourceDigest
  ) fail("first_publication_external_evidence_target_mismatch");
  const checkedAtMs = timestamp(checkedAt);
  if (
    timestamp(report.validity.checkedAt) > checkedAtMs ||
    timestamp(report.validity.validUntil) <= checkedAtMs
  ) fail("first_publication_external_evidence_expired");
}

function validateIdentity(manifest, releaseManifest, report, authorization) {
  const target = report.target;
  const expectedRepository = `git+https://github.com/${target.repository}.git`;
  if (
    manifest?.name !== target.package || manifest.version !== target.version ||
    manifest.version !== authorization.target.version || manifest.private !== false ||
    manifest.license !== target.license || manifest.license === "UNLICENSED" ||
    manifest.repository?.type !== "git" || manifest.repository.url !== expectedRepository ||
    manifest.publishConfig?.access !== "public" ||
    manifest.publishConfig.registry !== npmPublicRegistry ||
    manifest.publishConfig.provenance === false ||
    releaseManifest?.artifact?.name !== manifest.name ||
    releaseManifest.artifact.version !== manifest.version ||
    releaseManifest.artifact.license !== manifest.license ||
    releaseManifest.artifact.repository !== expectedRepository ||
    releaseManifest.artifact.registry !== npmPublicRegistry ||
    releaseManifest.artifact.provenance === false ||
    releaseManifest.artifact.private !== false || releaseManifest.artifact.access !== "public"
  ) fail("first_publication_identity_unresolved");
}

function validatePackageObservation(observation) {
  if (observation?.state === "unavailable") {
    fail("first_publication_package_observation_unavailable");
  }
  if (canonicalJson(observation) !== canonicalJson({
    schemaVersion: 1,
    source: "npm_public_registry",
    state: "not_found",
    package: "@lervo/cli",
  })) fail("first_publication_package_not_missing");
}

export function validateFirstPublicationBootstrapLocalInputs({
  publicationAuthorization,
  packageManifest,
  releaseManifest,
  externalEvidenceReport,
  checkedAt,
}) {
  const authorization = validateReleasePublicationAuthorization(publicationAuthorization);
  validateEvidenceBinding(externalEvidenceReport, authorization, checkedAt);
  validateIdentity(packageManifest, releaseManifest, externalEvidenceReport, authorization);
  return authorization;
}

export function createFirstPublicationBootstrapAuthorization({
  publicationAuthorization,
  packageManifest,
  releaseManifest,
  externalEvidenceReport,
  packageObservation,
  observedAt,
}) {
  const authorization = validateFirstPublicationBootstrapLocalInputs({
    publicationAuthorization,
    packageManifest,
    releaseManifest,
    externalEvidenceReport,
    checkedAt: observedAt,
  });
  validatePackageObservation(packageObservation);
  const observedAtMs = timestamp(observedAt);
  const validUntil = new Date(Math.min(
    timestamp(externalEvidenceReport.validity.validUntil),
    observedAtMs + firstPublicationRegistryObservationLifetimeMs,
  )).toISOString();
  const body = {
    schemaVersion: 2,
    status: "bootstrap_authorized",
    target: structuredClone(authorization.target),
    identity: {
      repository: externalEvidenceReport.target.repository,
      license: externalEvidenceReport.target.license,
      scopeOwner: structuredClone(externalEvidenceReport.target.scopeOwner),
    },
    release: {
      publicationAuthorizationDigest: authorization.authorizationDigest,
      artifact: structuredClone(authorization.artifact),
      tag: authorization.release.tag,
      sourceDigest: authorization.release.sourceDigest,
    },
    evidence: {
      externalEvidenceReportDigest: externalEvidenceReport.evidenceReportDigest,
      postApplyReportDigest: externalEvidenceReport.localEvidence.postApplyReportDigest,
      receiptDigest: externalEvidenceReport.localEvidence.receiptDigest,
      licenseApprovalDigest: externalEvidenceReport.evidence.licenseApproval.approvalDigest,
      scopeConfirmationDigest:
        externalEvidenceReport.evidence.scopeControlConfirmation.confirmationDigest,
      firstPublicationApprovalDigest:
        externalEvidenceReport.evidence.firstPublicationApproval.approvalDigest,
      checkedAt: externalEvidenceReport.validity.checkedAt,
      validUntil: externalEvidenceReport.validity.validUntil,
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
