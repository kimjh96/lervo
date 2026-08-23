import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  validateFirstPublicationReconciliationReportDocument,
  validateFirstPublicationReconciliationReportSources,
} from "./first-publication-reconciliation-reader.mjs";
import { validateFirstPublicationResolutionDecision } from
  "./first-publication-resolution-decision.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const reservationIdPattern = /^fpr_[a-f0-9]{24}$/u;
const decisionIdPattern = /^res_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const authority = Object.freeze({
  transitionReview: "eligible",
  transitionCompletion: "not_authorized",
  executionReceipt: "not_recovered",
  retry: "forbidden",
});

const freshChecks = Object.freeze([
  "exact_public_release",
  "stage_only_workflow",
  "npm_trusted_publisher",
  "github_environment",
]);

const sideEffects = Object.freeze({
  reservation: "unchanged",
  terminal: "unchanged",
  executionReceipt: "not_created",
  publication: "not_attempted",
  externalSettings: "not_changed",
});

function fail(code = "first_publication_resolution_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication result-resolution document is invalid.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
}

function body(resolution) {
  return {
    schemaVersion: resolution.schemaVersion,
    status: resolution.status,
    resolutionType: resolution.resolutionType,
    target: resolution.target,
    binding: resolution.binding,
    resolvedAt: resolution.resolvedAt,
    freshReconciliationReport: resolution.freshReconciliationReport,
    authority: resolution.authority,
    requiredAtTransition: resolution.requiredAtTransition,
    preservedState: resolution.preservedState,
    sideEffects: resolution.sideEffects,
  };
}

export function validateFirstPublicationResolutionDocument(resolution) {
  const resolutionBody = body(resolution ?? {});
  timestamp(resolution?.resolvedAt);
  try {
    validateFirstPublicationReconciliationReportDocument(
      resolution?.freshReconciliationReport,
    );
  } catch {
    fail();
  }
  if (
    !exactKeys(resolution, [...Object.keys(resolutionBody), "resolutionDigest"]) ||
    resolution.schemaVersion !== 1 || resolution.status !== "transition_review_eligible" ||
    resolution.resolutionType !== "reconciled_first_publication" ||
    !exactKeys(resolution.target, ["registry", "package", "version", "distTag", "access"]) ||
    resolution.target.registry !== npmPublicRegistry || resolution.target.package !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(resolution.target.version ?? "") ||
    !["latest", "next"].includes(resolution.target.distTag) ||
    resolution.target.access !== "public" ||
    !exactKeys(resolution.binding, [
      "bootstrapDigest", "armingAuthorizationDigest", "publicationAuthorizationDigest",
      "reservationId", "reservationDigest", "terminalRecordDigest",
      "reviewedReconciliationReportDigest", "freshReconciliationReportDigest",
      "decisionId", "decisionDigest",
    ]) || !digestPattern.test(resolution.binding.bootstrapDigest ?? "") ||
    !digestPattern.test(resolution.binding.armingAuthorizationDigest ?? "") ||
    !digestPattern.test(resolution.binding.publicationAuthorizationDigest ?? "") ||
    !reservationIdPattern.test(resolution.binding.reservationId ?? "") ||
    !digestPattern.test(resolution.binding.reservationDigest ?? "") ||
    !digestPattern.test(resolution.binding.terminalRecordDigest ?? "") ||
    !digestPattern.test(resolution.binding.reviewedReconciliationReportDigest ?? "") ||
    !digestPattern.test(resolution.binding.freshReconciliationReportDigest ?? "") ||
    !decisionIdPattern.test(resolution.binding.decisionId ?? "") ||
    !digestPattern.test(resolution.binding.decisionDigest ?? "") ||
    resolution.freshReconciliationReport.outcome !== "published" ||
    resolution.freshReconciliationReport.reconciliationReportDigest !==
      resolution.binding.freshReconciliationReportDigest ||
    resolution.freshReconciliationReport.observation.observedAt !== resolution.resolvedAt ||
    canonicalJson(resolution.authority) !== canonicalJson(authority) ||
    canonicalJson(resolution.requiredAtTransition) !== canonicalJson(freshChecks) ||
    canonicalJson(resolution.preservedState) !== canonicalJson({
      terminal: "publication_unknown",
      terminalMutation: "forbidden",
    }) || canonicalJson(resolution.sideEffects) !== canonicalJson(sideEffects) ||
    !digestPattern.test(resolution.resolutionDigest ?? "") ||
    resolution.resolutionDigest !== canonicalDigest(resolutionBody)
  ) fail();
  return resolution;
}

export function createFirstPublicationResolution({
  bootstrap,
  armingAuthorization,
  publicationAuthorization,
  reservation,
  terminal,
  reconciliationReport,
  freshReconciliationReport,
  decision,
  resolvedAt,
}) {
  const sources = {
    bootstrap,
    armingAuthorization,
    publicationAuthorization,
    reservation,
    terminal,
  };
  validateFirstPublicationReconciliationReportSources(reconciliationReport, sources);
  validateFirstPublicationReconciliationReportSources(freshReconciliationReport, sources);
  if (
    reconciliationReport.outcome !== "published" ||
    freshReconciliationReport.outcome !== "published" ||
    timestamp(freshReconciliationReport.observation.observedAt) <
      timestamp(reconciliationReport.observation.observedAt) ||
    timestamp(resolvedAt) < timestamp(freshReconciliationReport.observation.observedAt)
  ) fail("first_publication_resolution_fresh_observation_required");
  validateFirstPublicationResolutionDecision(decision, {
    reconciliationReport,
    checkedAt: resolvedAt,
  });
  const resolutionBody = {
    schemaVersion: 1,
    status: "transition_review_eligible",
    resolutionType: "reconciled_first_publication",
    target: structuredClone(bootstrap.target),
    binding: {
      bootstrapDigest: bootstrap.bootstrapDigest,
      armingAuthorizationDigest: armingAuthorization.armingAuthorizationDigest,
      publicationAuthorizationDigest: publicationAuthorization.authorizationDigest,
      reservationId: reservation.reservationId,
      reservationDigest: reservation.reservationDigest,
      terminalRecordDigest: canonicalDigest(terminal),
      reviewedReconciliationReportDigest: reconciliationReport.reconciliationReportDigest,
      freshReconciliationReportDigest: freshReconciliationReport.reconciliationReportDigest,
      decisionId: decision.decisionId,
      decisionDigest: canonicalDigest(decision),
    },
    resolvedAt,
    freshReconciliationReport: structuredClone(freshReconciliationReport),
    authority: structuredClone(authority),
    requiredAtTransition: [...freshChecks],
    preservedState: {
      terminal: "publication_unknown",
      terminalMutation: "forbidden",
    },
    sideEffects: structuredClone(sideEffects),
  };
  return { ...resolutionBody, resolutionDigest: canonicalDigest(resolutionBody) };
}

export function validateFirstPublicationResolution(resolution, evidence) {
  validateFirstPublicationResolutionDocument(resolution);
  const expected = createFirstPublicationResolution({
    ...evidence,
    freshReconciliationReport: resolution.freshReconciliationReport,
    resolvedAt: resolution.resolvedAt,
  });
  if (canonicalJson(resolution) !== canonicalJson(expected)) fail();
  return resolution;
}
