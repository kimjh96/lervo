import {
  firstPublicationRegistryObservationLifetimeMs,
  FirstPublicationBootstrapError,
} from "./first-publication-bootstrap.mjs";
import { firstPublicationEvidenceTimestamp } from
  "./first-publication-external-evidence-documents.mjs";
import {
  validateFirstPublicationExternalEvidenceLocalInputs,
  validateFirstPublicationExternalPackageObservation,
} from "./first-publication-external-evidence-policy.mjs";
import {
  canonicalDigest,
  canonicalJson,
} from "./release-artifact-manifest.mjs";

function fail(code, message = "CLI 최초 게시 외부 요구사항 증거를 결속하지 못했습니다.") {
  throw new FirstPublicationBootstrapError(code, message);
}

function reportBody(input) {
  const authorization = validateFirstPublicationExternalEvidenceLocalInputs({
    ...input,
    checkedAt: input.observedAt,
  });
  validateFirstPublicationExternalPackageObservation(input.packageObservation);
  const observedAtMs = firstPublicationEvidenceTimestamp(
    input.observedAt,
    "first_publication_external_evidence_observation_invalid",
  );
  const observationValidUntilMs = observedAtMs + firstPublicationRegistryObservationLifetimeMs;
  const validUntil = new Date(Math.min(
    observationValidUntilMs,
    Date.parse(input.scopeConfirmation.expiresAt),
    Date.parse(input.firstPublicationApproval.expiresAt),
  )).toISOString();
  const body = {
    schemaVersion: 1,
    status: "evidence_bound",
    activation: "not_implemented",
    arming: "not_armed",
    target: structuredClone(input.postApplyReport.target),
    validity: {
      checkedAt: input.observedAt,
      validUntil,
    },
    localEvidence: {
      postApplyReportDigest: input.postApplyReport.reportDigest,
      receiptDigest: input.postApplyReport.receipt.receiptDigest,
    },
    release: {
      publicationAuthorizationDigest: authorization.authorizationDigest,
      artifactSha256: authorization.artifact.sha256,
      sourceDigest: authorization.release.sourceDigest,
    },
    evidence: {
      licenseApproval: {
        approvalId: input.licenseApproval.approvalId,
        approvalDigest: canonicalDigest(input.licenseApproval),
        approvedAt: input.licenseApproval.approvedAt,
        basis: "operator_attestation",
      },
      publicPackageAvailability: {
        state: "public_package_not_found",
        observationDigest: canonicalDigest(input.packageObservation),
        observedAt: input.observedAt,
        validUntil: new Date(observationValidUntilMs).toISOString(),
      },
      scopeControlConfirmation: {
        confirmationId: input.scopeConfirmation.confirmationId,
        confirmationDigest: canonicalDigest(input.scopeConfirmation),
        confirmedAt: input.scopeConfirmation.confirmedAt,
        expiresAt: input.scopeConfirmation.expiresAt,
        basis: "operator_attestation",
      },
      firstPublicationApproval: {
        approvalId: input.firstPublicationApproval.approvalId,
        approvalDigest: canonicalDigest(input.firstPublicationApproval),
        approvedAt: input.firstPublicationApproval.approvedAt,
        expiresAt: input.firstPublicationApproval.expiresAt,
      },
    },
    requirements: [
      { id: "license_approval", status: "bound" },
      { id: "public_package_availability", status: "bound" },
      { id: "scope_control_confirmation", status: "bound" },
      { id: "first_publication_approval", status: "bound" },
    ],
    limitations: {
      receiptAuthenticity: "not_verified",
      actorIdentity: "not_authenticated",
      scopeControlAuthority: "not_registry_verified",
      privatePackageAbsence: "not_observed",
      releaseArtifact: "not_revalidated",
    },
    sideEffects: {
      files: "not_changed",
      onlineObservation: "npm_public_registry_read_only",
      approval: "not_created",
      activation: "not_changed",
      publication: "not_attempted",
    },
  };
  return body;
}

export function createFirstPublicationExternalEvidenceReport(input) {
  const body = reportBody(input);
  return { ...body, evidenceReportDigest: canonicalDigest(body) };
}

export function validateFirstPublicationExternalEvidenceReport(report, input) {
  let expected;
  try {
    expected = createFirstPublicationExternalEvidenceReport(input);
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail("first_publication_external_evidence_report_invalid");
  }
  if (canonicalJson(report) !== canonicalJson(expected)) {
    fail("first_publication_external_evidence_report_invalid");
  }
  return report;
}
