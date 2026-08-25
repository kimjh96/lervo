import { validateFirstPublicationExecutionReceipt } from "./first-publication-execution-receipt.mjs";
import { validateFirstPublicationResolution } from "./first-publication-resolution.mjs";
import { validateFirstPublicationStageApprovalEvidenceSet } from "./first-publication-stage-approval-evidence-set.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";
import { validateReleasePublicationAuthorization } from "./release-publication-authorization.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_transition_evidence_invalid",
    "The CLI first-publication transition evidence is invalid.",
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

export function resolveFirstPublicationTransitionEvidence(publicationEvidence, sources) {
  if (
    publicationEvidence?.type === "execution_receipt" &&
    exactKeys(publicationEvidence, ["type", "executionReceipt"])
  ) {
    validateFirstPublicationExecutionReceipt(publicationEvidence.executionReceipt, sources);
    return {
      type: "execution_receipt",
      digest: publicationEvidence.executionReceipt.executionReceiptDigest,
      evidenceAt: publicationEvidence.executionReceipt.publication.publishedAt,
      basis: "publisher_receipt_verified",
    };
  }
  if (
    publicationEvidence?.type === "reconciliation_resolution" &&
    exactKeys(publicationEvidence, [
      "type",
      "resolution",
      "reconciliationReport",
      "decision",
      "reservation",
      "terminal",
    ])
  ) {
    validateFirstPublicationResolution(publicationEvidence.resolution, {
      ...sources,
      reconciliationReport: publicationEvidence.reconciliationReport,
      decision: publicationEvidence.decision,
      reservation: publicationEvidence.reservation,
      terminal: publicationEvidence.terminal,
    });
    return {
      type: "reconciliation_resolution",
      digest: publicationEvidence.resolution.resolutionDigest,
      evidenceAt: publicationEvidence.resolution.resolvedAt,
      basis: "public_registry_reconciliation_reviewed",
    };
  }
  if (
    publicationEvidence?.type === "stage_approval_reconciliation" &&
    exactKeys(publicationEvidence, [
      "type",
      "reconciliationReport",
      "stageReviewReport",
      "decision",
      "authorization",
      "attempt",
      "terminal",
    ])
  ) {
    const { reconciliationReport, stageReviewReport, decision, authorization, attempt, terminal } =
      publicationEvidence;
    validateFirstPublicationStageApprovalEvidenceSet({
      reconciliationReport,
      stageReviewReport,
      decision,
      authorization,
      attempt,
      terminal,
    });
    const bootstrap = sources.bootstrap;
    const releaseAuthorization = validateReleasePublicationAuthorization(
      sources.publicationAuthorization,
    );
    const stageArtifact = reconciliationReport.binding.artifact;
    if (
      reconciliationReport.outcome !== "public_release_confirmed" ||
      stageReviewReport.upstream.publicationAuthorizationDigest !==
        releaseAuthorization.authorizationDigest ||
      bootstrap.release.publicationAuthorizationDigest !==
        releaseAuthorization.authorizationDigest ||
      stageReviewReport.target.repository !== bootstrap.identity.repository ||
      stageReviewReport.target.sourceCommit !== bootstrap.release.sourceDigest ||
      stageReviewReport.target.package !== bootstrap.target.package ||
      stageReviewReport.target.version !== bootstrap.target.version ||
      authorization.binding.registry !== bootstrap.target.registry ||
      authorization.binding.distTag !== bootstrap.target.distTag ||
      stageArtifact.sha256 !== bootstrap.release.artifact.sha256 ||
      stageArtifact.registryIntegrity !== bootstrap.release.artifact.registryIntegrity ||
      stageArtifact.registryShasum !== bootstrap.release.artifact.registryShasum
    )
      fail();
    return {
      type: "stage_approval_reconciliation",
      digest: reconciliationReport.evidenceDigest,
      evidenceAt: reconciliationReport.npm.observedAt,
      basis: "npm_stage_approval_reconciliation_verified",
    };
  }
  fail();
}
