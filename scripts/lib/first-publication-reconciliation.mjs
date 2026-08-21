import { validateFirstPublicationArmingAuthorization } from
  "./first-publication-arming-authorization.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationReservation } from
  "./first-publication-reservation.mjs";
import { validateStoredFirstPublicationTerminal } from
  "./first-publication-store-records.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateReleasePublicationAuthorization } from
  "./release-publication-authorization.mjs";

const sha1Pattern = /^[a-f0-9]{40}$/u;
const sha512IntegrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const sideEffects = Object.freeze({
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
    "first_publication_reconciliation_invalid",
    "CLI 최초 게시 결과 대조 입력이 올바르지 않습니다.",
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

function validateObservation(observation, target) {
  if (
    observation?.schemaVersion !== 1 ||
    observation.source !== "npm_public_registry_reconciliation" ||
    observation.package !== target.package || observation.version !== target.version ||
    observation.distTag !== target.distTag
  ) fail();
  if (observation.state === "unavailable") {
    if (!exactKeys(observation, [
      "schemaVersion", "source", "state", "package", "version", "distTag", "reason",
    ]) || observation.reason !== "registry_unavailable") fail();
    return observation;
  }
  if (
    observation.state !== "observed" || !exactKeys(observation, [
      "schemaVersion", "source", "state", "package", "version", "distTag",
      "versionMetadata", "distTagValue",
    ]) || !exactKeys(observation.versionMetadata,
      observation.versionMetadata?.state === "found"
        ? ["state", "registryIntegrity", "registryShasum"]
        : ["state"]) ||
    !["found", "not_found"].includes(observation.versionMetadata.state) ||
    !exactKeys(observation.distTagValue,
      observation.distTagValue?.state === "found" ? ["state", "version"] : ["state"]) ||
    !["found", "not_found"].includes(observation.distTagValue.state)
  ) fail();
  if (
    observation.versionMetadata.state === "found" &&
    (!sha512IntegrityPattern.test(observation.versionMetadata.registryIntegrity ?? "") ||
      !sha1Pattern.test(observation.versionMetadata.registryShasum ?? ""))
  ) fail();
  if (
    observation.distTagValue.state === "found" &&
    (typeof observation.distTagValue.version !== "string" ||
      observation.distTagValue.version.length < 1 || observation.distTagValue.version.length > 128 ||
      /[\p{Cc}\p{Cf}]/u.test(observation.distTagValue.version))
  ) fail();
  return observation;
}

function check(id, status, reasons = []) {
  return { id, status, reasons };
}

function registryChecks(observation, artifact, target) {
  if (observation.state === "unavailable") {
    return [
      check("exact_version", "unknown", ["registry_unavailable"]),
      check("target_dist_tag", "unknown", ["registry_unavailable"]),
    ];
  }
  const version = observation.versionMetadata;
  const versionMatches = version.state === "found" &&
    version.registryIntegrity === artifact.registryIntegrity &&
    version.registryShasum === artifact.registryShasum;
  const versionCheck = version.state === "not_found"
    ? check("exact_version", "not_observed", ["target_version_not_observed"])
    : versionMatches
      ? check("exact_version", "matched")
      : check("exact_version", "unknown", ["exact_release_mismatch"]);
  const tagMatches = observation.distTagValue.state === "found" &&
    observation.distTagValue.version === target.version;
  const tagCheck = tagMatches
    ? check("target_dist_tag", "matched")
    : check("target_dist_tag", "not_observed", ["target_dist_tag_not_observed"]);
  return [versionCheck, tagCheck];
}

function outcome(checks) {
  if (checks.every(({ status }) => status === "matched")) return "published";
  if (checks[0].status === "not_observed" && checks[1].status === "not_observed") {
    return "not_observed";
  }
  return "unknown";
}

export function createFirstPublicationReconciliationReport({
  bootstrap,
  armingAuthorization,
  publicationAuthorization,
  reservation,
  terminal,
  npmObservation,
  observedAt,
}) {
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
    terminal.state !== "publication_unknown" || terminal.retry !== "forbidden" ||
    terminal.reservationId !== reservation.reservationId ||
    terminal.reservationDigest !== reservation.reservationDigest ||
    timestamp(observedAt) < timestamp(reservation.reservedAt)
  ) fail();
  const observation = validateObservation(npmObservation, bootstrap.target);
  const checks = registryChecks(observation, bootstrap.release.artifact, bootstrap.target);
  const body = {
    schemaVersion: 1,
    outcome: outcome(checks),
    advisoryOnly: true,
    target: structuredClone(bootstrap.target),
    binding: {
      bootstrapDigest: bootstrap.bootstrapDigest,
      armingAuthorizationDigest: armingAuthorization.armingAuthorizationDigest,
      publicationAuthorizationDigest: authorization.authorizationDigest,
      reservationId: reservation.reservationId,
      reservationDigest: reservation.reservationDigest,
      terminalRecordDigest: canonicalDigest(terminal),
    },
    observation: {
      source: "npm_public_registry_read_only",
      observedAt,
    },
    checks,
    disposition: structuredClone(sideEffects),
    limitations: [...limitations],
  };
  return { ...body, reconciliationReportDigest: canonicalDigest(body) };
}

export function validateFirstPublicationReconciliationReport(report, evidence) {
  const expected = createFirstPublicationReconciliationReport(evidence);
  if (canonicalJson(report) !== canonicalJson(expected)) fail();
  return report;
}
