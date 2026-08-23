import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationStageApprovalEvidenceSet } from
  "./first-publication-stage-approval-evidence-set.mjs";
import { validateFirstPublicationStageEvidenceBundleDocument } from
  "./first-publication-stage-evidence-bundle.mjs";
import { validateFirstPublicationTransitionReceiptDocument } from
  "./first-publication-transition.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const checkIds = Object.freeze([
  "stage_bundle_sources_current",
  "stage_transition_receipt_valid",
  "stage_evidence_matches_transition",
  "recorded_completion_semantics",
]);
const inspectionLimitations = Object.freeze({
  bootstrapSource: "not_reloaded",
  publicationAuthorizationSource: "not_reloaded",
  currentPublicRegistry: "not_reobserved",
  currentWorkflow: "not_reloaded",
  currentNpmTrust: "not_reobserved",
  currentGitHubEnvironment: "not_reobserved",
  receiptSigner: "not_verified",
});
const inspectionSideEffects = Object.freeze({
  files: "unchanged",
  network: "not_used",
  npmSettings: "not_changed",
  githubSettings: "not_changed",
  publication: "not_attempted",
  runtimeState: "not_changed",
});

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_completion_inspection_invalid",
    "The CLI first-publication completion inspection result is invalid.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value) ||
      !Number.isFinite(Date.parse(value))) fail();
  return Date.parse(value);
}

function assertCompletionBinding({ bundle, evidenceSet, transitionReceipt }) {
  validateFirstPublicationStageEvidenceBundleDocument(bundle);
  validateFirstPublicationStageApprovalEvidenceSet(evidenceSet);
  validateFirstPublicationTransitionReceiptDocument(transitionReceipt);
  const evidence = transitionReceipt.publicationEvidence;
  const target = transitionReceipt.publicRelease.target;
  const artifact = transitionReceipt.publicRelease.artifact;
  const attempt = evidenceSet.attempt;
  if (
    transitionReceipt.schemaVersion !== 3 ||
    evidence.type !== "stage_approval_reconciliation" ||
    evidence.basis !== "npm_stage_approval_reconciliation_verified" ||
    evidence.digest !== evidenceSet.reconciliationReport.evidenceDigest ||
    evidence.evidenceAt !== evidenceSet.reconciliationReport.npm.observedAt ||
    target.registry !== attempt.stage.registry ||
    target.package !== attempt.target.package || target.version !== attempt.target.version ||
    target.distTag !== attempt.stage.distTag || target.access !== "public" ||
    artifact.registryIntegrity !== attempt.artifact.registryIntegrity ||
    artifact.registryShasum !== attempt.artifact.registryShasum
  ) fail();
}

function body(report) {
  return {
    schemaVersion: report.schemaVersion,
    status: report.status,
    inspectionType: report.inspectionType,
    inspectedAt: report.inspectedAt,
    completion: report.completion,
    provenance: report.provenance,
    checks: report.checks,
    manualActionScope: report.manualActionScope,
    remainingManualActions: report.remainingManualActions,
    limitations: report.limitations,
    sideEffects: report.sideEffects,
  };
}

export function createFirstPublicationCompletionInspection({
  bundle,
  evidenceSet,
  transitionReceipt,
  inspectedAt,
}) {
  assertCompletionBinding({ bundle, evidenceSet, transitionReceipt });
  if (timestamp(inspectedAt) < timestamp(transitionReceipt.transition.completedAt)) fail();
  const value = {
    schemaVersion: 1,
    status: "completion_recorded",
    inspectionType: "first_publication_stage_completion",
    inspectedAt,
    completion: {
      state: "completed",
      bootstrapState: "consumed",
      mode: "trusted_publisher_stage_only",
      completedAt: transitionReceipt.transition.completedAt,
    },
    provenance: {
      stageBundleDigest: bundle.bundleDigest,
      transitionReceiptDigest: transitionReceipt.transitionReceiptDigest,
      publicationEvidence: structuredClone(transitionReceipt.publicationEvidence),
    },
    checks: checkIds.map((id) => ({ id, status: "verified" })),
    manualActionScope: "recorded_first_publication_transition",
    remainingManualActions: [],
    limitations: structuredClone(inspectionLimitations),
    sideEffects: structuredClone(inspectionSideEffects),
  };
  return validateFirstPublicationCompletionInspectionDocument({
    ...value,
    inspectionDigest: canonicalDigest(value),
  });
}

export function validateFirstPublicationCompletionInspectionDocument(report) {
  const value = body(report ?? {});
  const completion = report?.completion;
  const provenance = report?.provenance;
  const evidence = provenance?.publicationEvidence;
  if (
    !exactKeys(report, [...Object.keys(value), "inspectionDigest"]) ||
    report.schemaVersion !== 1 || report.status !== "completion_recorded" ||
    report.inspectionType !== "first_publication_stage_completion" ||
    timestamp(report.inspectedAt) < timestamp(completion?.completedAt) ||
    !exactKeys(completion, ["state", "bootstrapState", "mode", "completedAt"]) ||
    completion.state !== "completed" || completion.bootstrapState !== "consumed" ||
    completion.mode !== "trusted_publisher_stage_only" ||
    !exactKeys(provenance, [
      "stageBundleDigest", "transitionReceiptDigest", "publicationEvidence",
    ]) || !digestPattern.test(provenance.stageBundleDigest ?? "") ||
    !digestPattern.test(provenance.transitionReceiptDigest ?? "") ||
    !exactKeys(evidence, ["type", "digest", "evidenceAt", "basis"]) ||
    evidence.type !== "stage_approval_reconciliation" ||
    evidence.basis !== "npm_stage_approval_reconciliation_verified" ||
    !digestPattern.test(evidence.digest ?? "") ||
    timestamp(completion?.completedAt) < timestamp(evidence.evidenceAt) ||
    !Array.isArray(report.checks) || report.checks.length !== checkIds.length ||
    report.checks.some((check, index) =>
      !exactKeys(check, ["id", "status"]) || check.id !== checkIds[index] ||
      check.status !== "verified"
    ) || report.manualActionScope !== "recorded_first_publication_transition" ||
    !Array.isArray(report.remainingManualActions) ||
    report.remainingManualActions.length !== 0 ||
    !exactKeys(report.limitations, Object.keys(inspectionLimitations)) ||
    canonicalJson(report.limitations) !== canonicalJson(inspectionLimitations) ||
    !exactKeys(report.sideEffects, Object.keys(inspectionSideEffects)) ||
    canonicalJson(report.sideEffects) !== canonicalJson(inspectionSideEffects) ||
    !digestPattern.test(report.inspectionDigest ?? "") ||
    report.inspectionDigest !== canonicalDigest(value)
  ) fail();
  return report;
}
