import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { validateFirstPublicationArmingAuthorization } from
  "./first-publication-arming-authorization.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const reservationIdPattern = /^fpr_[a-f0-9]{24}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function fail(code = "first_publication_reservation_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI 최초 게시 예약이 올바르지 않습니다.",
  );
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
}

export function createFirstPublicationReservation({
  bootstrap,
  armingAuthorization,
  publicationAuthorization,
  reservedAt,
}) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  validateFirstPublicationArmingAuthorization(armingAuthorization, {
    bootstrap,
    publicationAuthorization,
    checkedAt: reservedAt,
  });
  const reservedMilliseconds = timestamp(reservedAt);
  if (
    reservedMilliseconds < timestamp(bootstrap.registryObservation.observedAt) ||
    reservedMilliseconds >= timestamp(bootstrap.registryObservation.validUntil)
  ) fail("first_publication_bootstrap_expired");
  const body = {
    schemaVersion: 2,
    reservationId: firstPublicationReservationId(bootstrap),
    state: "reserved",
    bootstrapDigest: bootstrap.bootstrapDigest,
    armingAuthorizationDigest: armingAuthorization.armingAuthorizationDigest,
    publicationAuthorizationDigest: bootstrap.release.publicationAuthorizationDigest,
    artifactSha256: bootstrap.release.artifact.sha256,
    reservedAt,
  };
  return { ...body, reservationDigest: canonicalDigest(body) };
}

export function firstPublicationReservationId(bootstrap) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  return `fpr_${bootstrap.bootstrapDigest.slice("sha256:".length, 31)}`;
}

export function validateFirstPublicationReservation(reservation, {
  bootstrap,
  armingAuthorization,
  publicationAuthorization,
}) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  validateFirstPublicationArmingAuthorization(armingAuthorization, {
    bootstrap,
    publicationAuthorization,
    checkedAt: reservation?.reservedAt,
  });
  const body = {
    schemaVersion: reservation?.schemaVersion,
    reservationId: reservation?.reservationId,
    state: reservation?.state,
    bootstrapDigest: reservation?.bootstrapDigest,
    armingAuthorizationDigest: reservation?.armingAuthorizationDigest,
    publicationAuthorizationDigest: reservation?.publicationAuthorizationDigest,
    artifactSha256: reservation?.artifactSha256,
    reservedAt: reservation?.reservedAt,
  };
  if (
    reservation === null || typeof reservation !== "object" || Array.isArray(reservation) ||
    canonicalJson(Object.keys(reservation).sort()) !==
      canonicalJson([...Object.keys(body), "reservationDigest"].sort()) ||
    reservation.schemaVersion !== 2 ||
    !reservationIdPattern.test(reservation.reservationId ?? "") ||
    reservation.state !== "reserved" ||
    reservation.bootstrapDigest !== bootstrap.bootstrapDigest ||
    reservation.armingAuthorizationDigest !==
      armingAuthorization.armingAuthorizationDigest ||
    reservation.publicationAuthorizationDigest !== bootstrap.release.publicationAuthorizationDigest ||
    reservation.artifactSha256 !== bootstrap.release.artifact.sha256 ||
    !digestPattern.test(reservation.reservationDigest ?? "") ||
    reservation.reservationDigest !== canonicalDigest(body)
  ) fail();
  timestamp(reservation.reservedAt);
  return reservation;
}
