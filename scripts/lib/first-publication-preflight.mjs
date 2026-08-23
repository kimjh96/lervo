import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { firstPublicationReservationId } from "./first-publication-reservation.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateNpmInteractiveFirstPublicationObservation } from
  "./npm-interactive-first-publication-policy.mjs";
import { validateReleasePublicationAuthorization } from
  "./release-publication-authorization.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const terminalStates = new Set([
  "published", "aborted_before_publication", "publication_unknown",
]);
const sideEffects = {
  reservation: "not_created",
  publication: "not_attempted",
  externalSettings: "not_changed",
};

function fail(code = "first_publication_preflight_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication preflight report is invalid.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function milliseconds(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail();
  return parsed;
}

function validateArtifact(observation, bootstrap) {
  const base = ["schemaVersion", "source", "state"];
  if (
    observation?.schemaVersion !== 1 || observation.source !== "first_publication_artifact" ||
    !["verified", "changed", "unavailable"].includes(observation.state)
  ) fail();
  if (observation.state === "unavailable") {
    if (!exactKeys(observation, [...base, "reason"]) ||
        observation.reason !== "artifact_unavailable") fail();
    return { id: "release_artifact", status: "unknown", reasons: ["artifact_unavailable"] };
  }
  if (!exactKeys(observation, [...base, "artifactSha256"]) ||
      !/^[a-f0-9]{64}$/u.test(observation.artifactSha256 ?? "")) fail();
  const matches = observation.state === "verified" &&
    observation.artifactSha256 === bootstrap.release.artifact.sha256;
  return matches
    ? { id: "release_artifact", status: "ready", reasons: [] }
    : { id: "release_artifact", status: "blocked", reasons: ["artifact_changed"] };
}

function validatePackage(observation) {
  const base = ["schemaVersion", "source", "state", "package"];
  if (
    observation?.schemaVersion !== 1 || observation.source !== "npm_public_registry" ||
    observation.package !== "@lervo/cli" ||
    !["not_found", "existing", "unavailable"].includes(observation.state)
  ) fail();
  if (observation.state === "unavailable") {
    if (!exactKeys(observation, [...base, "reason"]) ||
        observation.reason !== "registry_unavailable") fail();
    return { id: "public_package_absence", status: "unknown", reasons: ["registry_unavailable"] };
  }
  if (!exactKeys(observation, base)) fail();
  return observation.state === "not_found"
    ? { id: "public_package_absence", status: "ready", reasons: [] }
    : { id: "public_package_absence", status: "blocked", reasons: ["public_package_exists"] };
}

function validateReservation(observation, bootstrap) {
  const base = ["schemaVersion", "source", "state", "reservationId"];
  const expectedId = firstPublicationReservationId(bootstrap);
  if (
    observation?.schemaVersion !== 1 ||
    observation.source !== "first_publication_reservation_store" ||
    observation.reservationId !== expectedId ||
    !["missing", "reserved", "terminal", "unavailable"].includes(observation.state)
  ) fail();
  if (observation.state === "missing") {
    if (!exactKeys(observation, base)) fail();
    return { id: "reservation_state", status: "ready", reasons: [] };
  }
  if (observation.state === "unavailable") {
    if (!exactKeys(observation, [...base, "reason"]) ||
        observation.reason !== "reservation_store_unavailable") fail();
    return { id: "reservation_state", status: "unknown", reasons: [observation.reason] };
  }
  const recordKeys = [...base, "bootstrapDigest", "reservationDigest"];
  if (
    observation.bootstrapDigest !== bootstrap.bootstrapDigest ||
    !digestPattern.test(observation.reservationDigest ?? "")
  ) fail();
  if (observation.state === "terminal") {
    if (!exactKeys(observation, [...recordKeys, "terminalState"]) ||
        !terminalStates.has(observation.terminalState)) fail();
    return { id: "reservation_state", status: "blocked", reasons: ["publication_already_terminal"] };
  }
  if (!exactKeys(observation, recordKeys)) fail();
  return { id: "reservation_state", status: "blocked", reasons: ["publication_already_reserved"] };
}

function npmCheck(observation) {
  try {
    validateNpmInteractiveFirstPublicationObservation(observation);
  } catch {
    fail();
  }
  return {
    id: "npm_interactive_readiness",
    status: observation.state === "ready" ? "ready" :
      observation.state === "unavailable" ? "unknown" : "blocked",
    reasons: [...observation.reasons],
  };
}

function freshnessCheck(bootstrap, checkedAt) {
  const checked = milliseconds(checkedAt);
  const observed = milliseconds(bootstrap.registryObservation.observedAt);
  const validUntil = milliseconds(bootstrap.registryObservation.validUntil);
  if (checked < observed) {
    return { id: "bootstrap_freshness", status: "blocked", reasons: ["check_precedes_observation"] };
  }
  if (checked >= validUntil) {
    return { id: "bootstrap_freshness", status: "blocked", reasons: ["bootstrap_expired"] };
  }
  return { id: "bootstrap_freshness", status: "ready", reasons: [] };
}

function reportBody(report) {
  return {
    schemaVersion: report.schemaVersion,
    status: report.status,
    advisoryOnly: report.advisoryOnly,
    bootstrapDigest: report.bootstrapDigest,
    publicationAuthorizationDigest: report.publicationAuthorizationDigest,
    checkedAt: report.checkedAt,
    checks: report.checks,
    sideEffects: report.sideEffects,
  };
}

export function createFirstPublicationPreflightReport({
  bootstrap,
  publicationAuthorization,
  artifactObservation,
  packageObservation,
  reservationObservation,
  npmObservation,
  checkedAt,
}) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  const authorization = validateReleasePublicationAuthorization(publicationAuthorization);
  if (authorization.authorizationDigest !== bootstrap.release.publicationAuthorizationDigest ||
      canonicalJson(authorization.target) !== canonicalJson(bootstrap.target) ||
      canonicalJson(authorization.artifact) !== canonicalJson(bootstrap.release.artifact)) {
    fail("first_publication_preflight_authorization_mismatch");
  }
  const checks = [
    freshnessCheck(bootstrap, checkedAt),
    validateArtifact(artifactObservation, bootstrap),
    validatePackage(packageObservation),
    validateReservation(reservationObservation, bootstrap),
    npmCheck(npmObservation),
  ];
  const body = {
    schemaVersion: 1,
    status: checks.every(({ status }) => status === "ready") ? "ready" : "blocked",
    advisoryOnly: true,
    bootstrapDigest: bootstrap.bootstrapDigest,
    publicationAuthorizationDigest: authorization.authorizationDigest,
    checkedAt,
    checks,
    sideEffects: structuredClone(sideEffects),
  };
  return { ...body, preflightDigest: canonicalDigest(body) };
}

export function validateFirstPublicationPreflightReport(report, evidence) {
  const body = reportBody(report ?? {});
  if (
    !exactKeys(report, [...Object.keys(body), "preflightDigest"]) ||
    report.schemaVersion !== 1 || !["ready", "blocked"].includes(report.status) ||
    report.advisoryOnly !== true || !digestPattern.test(report.bootstrapDigest ?? "") ||
    !digestPattern.test(report.publicationAuthorizationDigest ?? "") ||
    canonicalJson(report.sideEffects) !== canonicalJson(sideEffects) ||
    !Array.isArray(report.checks) || report.checks.length !== 5 ||
    canonicalJson(report.checks.map(({ id }) => id)) !== canonicalJson([
      "bootstrap_freshness", "release_artifact", "public_package_absence",
      "reservation_state", "npm_interactive_readiness",
    ]) ||
    report.checks.some((check) => !exactKeys(check, ["id", "status", "reasons"]) ||
      !["ready", "blocked", "unknown"].includes(check.status) ||
      !Array.isArray(check.reasons) ||
      (check.status === "ready") !== (check.reasons.length === 0)) ||
    (report.status === "ready") !== report.checks.every(({ status }) => status === "ready") ||
    report.preflightDigest !== canonicalDigest(body)
  ) fail();
  milliseconds(report.checkedAt);
  let expected;
  try {
    expected = createFirstPublicationPreflightReport(evidence);
  } catch {
    fail();
  }
  if (canonicalJson(expected) !== canonicalJson(report)) fail();
  return report;
}
