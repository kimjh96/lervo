import { validateFirstPublicationArmingAuthorization } from
  "./first-publication-arming-authorization.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationReservation } from
  "./first-publication-reservation.mjs";
import { validateStoredFirstPublicationTerminal } from
  "./first-publication-store-records.mjs";
import { inspectFirstPublicationPublicRelease } from
  "./first-publication-public-release-policy.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateReleasePublicationAuthorization } from
  "./release-publication-authorization.mjs";

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

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
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
  let release;
  try {
    release = inspectFirstPublicationPublicRelease({
      observation: npmObservation,
      target: bootstrap.target,
      artifact: bootstrap.release.artifact,
    });
  } catch {
    fail();
  }
  const body = {
    schemaVersion: 1,
    outcome: release.outcome,
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
    checks: release.checks,
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
