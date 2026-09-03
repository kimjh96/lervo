import { validateFirstPublicationArmingAuthorization } from "./first-publication-arming-authorization.mjs";
import { validateFirstPublicationBootstrapAuthorization } from "./first-publication-bootstrap-reader.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationReservation } from "../shared/first-publication-reservation.mjs";
import { validateStoredFirstPublicationTerminal } from "../shared/first-publication-store-records.mjs";
import { canonicalDigest, canonicalJson } from "../../../shared/release-artifact-manifest.mjs";
import {
  npmPublicRegistry,
  validateReleasePublicationAuthorization,
} from "../../lib/release-publication-authorization.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const reservationIdPattern = /^fpr_[a-f0-9]{24}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const disposition = Object.freeze({
  reservation: "unchanged",
  terminal: "unchanged",
  publication: "not_attempted",
  externalSettings: "not_changed",
});

const limitations = Object.freeze([
  "public_registry_observation_only",
  "private_package_state_not_observed",
  "no_automatic_retry_authority",
  "does_not_complete_transition",
]);

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_reconciliation_report_invalid",
    "The CLI first-publication reconciliation report is invalid.",
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

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
}

function versionCheck(status, reason) {
  return {
    id: "exact_version",
    status,
    reasons: reason === undefined ? [] : [reason],
  };
}

function tagCheck(status, reason) {
  return {
    id: "target_dist_tag",
    status,
    reasons: reason === undefined ? [] : [reason],
  };
}

const allowedChecks = new Map([
  [canonicalJson([versionCheck("matched"), tagCheck("matched")]), "published"],
  [
    canonicalJson([
      versionCheck("not_observed", "target_version_not_observed"),
      tagCheck("not_observed", "target_dist_tag_not_observed"),
    ]),
    "not_observed",
  ],
  [
    canonicalJson([
      versionCheck("unknown", "registry_unavailable"),
      tagCheck("unknown", "registry_unavailable"),
    ]),
    "unknown",
  ],
  [
    canonicalJson([versionCheck("unknown", "exact_release_mismatch"), tagCheck("matched")]),
    "unknown",
  ],
  [
    canonicalJson([
      versionCheck("unknown", "exact_release_mismatch"),
      tagCheck("not_observed", "target_dist_tag_not_observed"),
    ]),
    "unknown",
  ],
  [
    canonicalJson([
      versionCheck("matched"),
      tagCheck("not_observed", "target_dist_tag_not_observed"),
    ]),
    "unknown",
  ],
  [
    canonicalJson([
      versionCheck("not_observed", "target_version_not_observed"),
      tagCheck("matched"),
    ]),
    "unknown",
  ],
]);

function reportBody(report) {
  return {
    schemaVersion: report.schemaVersion,
    outcome: report.outcome,
    advisoryOnly: report.advisoryOnly,
    target: report.target,
    binding: report.binding,
    observation: report.observation,
    checks: report.checks,
    disposition: report.disposition,
    limitations: report.limitations,
  };
}

export function validateFirstPublicationReconciliationReportDocument(report) {
  const body = reportBody(report ?? {});
  const expectedOutcome = allowedChecks.get(canonicalJson(report?.checks));
  timestamp(report?.observation?.observedAt);
  if (
    !exactKeys(report, [...Object.keys(body), "reconciliationReportDigest"]) ||
    report.schemaVersion !== 1 ||
    report.outcome !== expectedOutcome ||
    report.advisoryOnly !== true ||
    !exactKeys(report.target, ["registry", "package", "version", "distTag", "access"]) ||
    report.target.registry !== npmPublicRegistry ||
    report.target.package !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(report.target.version ?? "") ||
    !["latest", "next"].includes(report.target.distTag) ||
    report.target.access !== "public" ||
    !exactKeys(report.binding, [
      "bootstrapDigest",
      "armingAuthorizationDigest",
      "publicationAuthorizationDigest",
      "reservationId",
      "reservationDigest",
      "terminalRecordDigest",
    ]) ||
    !digestPattern.test(report.binding.bootstrapDigest ?? "") ||
    !digestPattern.test(report.binding.armingAuthorizationDigest ?? "") ||
    !digestPattern.test(report.binding.publicationAuthorizationDigest ?? "") ||
    !reservationIdPattern.test(report.binding.reservationId ?? "") ||
    !digestPattern.test(report.binding.reservationDigest ?? "") ||
    !digestPattern.test(report.binding.terminalRecordDigest ?? "") ||
    !exactKeys(report.observation, ["source", "observedAt"]) ||
    report.observation.source !== "npm_public_registry_read_only" ||
    canonicalJson(report.disposition) !== canonicalJson(disposition) ||
    canonicalJson(report.limitations) !== canonicalJson(limitations) ||
    !digestPattern.test(report.reconciliationReportDigest ?? "") ||
    report.reconciliationReportDigest !== canonicalDigest(body)
  )
    fail();
  return report;
}

export function validateFirstPublicationReconciliationReportSources(
  report,
  { bootstrap, armingAuthorization, publicationAuthorization, reservation, terminal },
) {
  validateFirstPublicationReconciliationReportDocument(report);
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  const authorization = validateReleasePublicationAuthorization(publicationAuthorization);
  validateFirstPublicationArmingAuthorization(armingAuthorization, {
    bootstrap,
    publicationAuthorization: authorization,
    checkedAt: armingAuthorization?.validity?.armedAt,
  });
  validateFirstPublicationReservation(reservation, {
    bootstrap,
    armingAuthorization,
    publicationAuthorization: authorization,
  });
  validateStoredFirstPublicationTerminal(terminal);
  if (
    canonicalJson(report.target) !== canonicalJson(bootstrap.target) ||
    report.binding.bootstrapDigest !== bootstrap.bootstrapDigest ||
    report.binding.armingAuthorizationDigest !== armingAuthorization.armingAuthorizationDigest ||
    report.binding.publicationAuthorizationDigest !== authorization.authorizationDigest ||
    report.binding.reservationId !== reservation.reservationId ||
    report.binding.reservationDigest !== reservation.reservationDigest ||
    report.binding.terminalRecordDigest !== canonicalDigest(terminal) ||
    terminal.state !== "publication_unknown" ||
    terminal.retry !== "forbidden" ||
    timestamp(report.observation.observedAt) < timestamp(reservation.reservedAt)
  )
    fail();
  return report;
}
