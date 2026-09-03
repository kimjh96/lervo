import {
  FirstPublicationBootstrapError,
  validateFirstPublicationApproval,
} from "../transition/first-publication-bootstrap.mjs";
import {
  validateFirstPublicationLicenseApproval,
  validateFirstPublicationScopeControlConfirmation,
} from "./first-publication-external-evidence-documents.mjs";
import { canonicalJson } from "../../../shared/release-artifact-manifest.mjs";
import {
  npmPublicRegistry,
  validateReleasePublicationAuthorization,
} from "../../lib/release-publication-authorization.mjs";

function fail(code) {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI first-publication external-requirements evidence could not be bound.",
  );
}

function validatePostApplyTarget(postApplyReport, authorization) {
  const target = postApplyReport?.target;
  if (
    postApplyReport?.status !== "verified" ||
    postApplyReport.activation !== "not_implemented" ||
    target?.package !== authorization.target.package ||
    target.version !== authorization.target.version ||
    target.registry !== npmPublicRegistry ||
    target.repository !== authorization.release.repository ||
    typeof target.license !== "string" ||
    target.license === "UNLICENSED"
  )
    fail("first_publication_external_evidence_target_mismatch");
}

export function validateFirstPublicationExternalEvidenceLocalInputs(input) {
  const authorization = validateReleasePublicationAuthorization(input.publicationAuthorization);
  validatePostApplyTarget(input.postApplyReport, authorization);
  validateFirstPublicationLicenseApproval(
    input.licenseApproval,
    input.postApplyReport,
    input.checkedAt,
  );
  validateFirstPublicationScopeControlConfirmation(
    input.scopeConfirmation,
    input.postApplyReport,
    input.checkedAt,
  );
  validateFirstPublicationApproval({
    approval: input.firstPublicationApproval,
    publicationAuthorization: authorization,
    checkedAt: input.checkedAt,
  });
  const approvedTarget = input.firstPublicationApproval.target;
  if (
    approvedTarget.repository !== input.postApplyReport.target.repository ||
    approvedTarget.license !== input.postApplyReport.target.license ||
    canonicalJson(approvedTarget.scopeOwner) !==
      canonicalJson(input.scopeConfirmation.target.scopeOwner)
  )
    fail("first_publication_external_evidence_target_mismatch");
  return authorization;
}

export function validateFirstPublicationExternalPackageObservation(observation) {
  if (
    canonicalJson(observation) !==
    canonicalJson({
      schemaVersion: 1,
      source: "npm_public_registry",
      state: "not_found",
      package: "@lervo/cli",
    })
  ) {
    const code =
      observation?.state === "unavailable"
        ? "first_publication_external_evidence_observation_unavailable"
        : "first_publication_external_evidence_package_not_available";
    fail(code);
  }
  return observation;
}
