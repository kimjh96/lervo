import { validateFirstPublicationExecutionReceipt } from
  "./first-publication-execution-receipt.mjs";
import { validateFirstPublicationResolution } from
  "./first-publication-resolution.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_transition_evidence_invalid",
    "CLI 최초 게시 전환 증거가 올바르지 않습니다.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
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
      "type", "resolution", "reconciliationReport", "decision", "reservation", "terminal",
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
  fail();
}
