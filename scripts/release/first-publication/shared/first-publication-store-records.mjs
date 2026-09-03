import { canonicalDigest, canonicalJson } from "../../../shared/release-artifact-manifest.mjs";
import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";

const reservationIdPattern = /^fpr_[a-f0-9]{24}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function fail(code) {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication stored document is invalid.",
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

export function validateStoredFirstPublicationReservation(record) {
  const body = {
    schemaVersion: record?.schemaVersion,
    reservationId: record?.reservationId,
    state: record?.state,
    bootstrapDigest: record?.bootstrapDigest,
    armingAuthorizationDigest: record?.armingAuthorizationDigest,
    publicationAuthorizationDigest: record?.publicationAuthorizationDigest,
    artifactSha256: record?.artifactSha256,
    reservedAt: record?.reservedAt,
  };
  if (
    !exactKeys(record, [...Object.keys(body), "reservationDigest"]) ||
    record.schemaVersion !== 2 ||
    !reservationIdPattern.test(record.reservationId ?? "") ||
    record.state !== "reserved" ||
    !digestPattern.test(record.bootstrapDigest ?? "") ||
    !digestPattern.test(record.armingAuthorizationDigest ?? "") ||
    !digestPattern.test(record.publicationAuthorizationDigest ?? "") ||
    !/^[a-f0-9]{64}$/u.test(record.artifactSha256 ?? "") ||
    !digestPattern.test(record.reservationDigest ?? "") ||
    record.reservationDigest !== canonicalDigest(body) ||
    !Number.isFinite(Date.parse(record.reservedAt ?? ""))
  )
    fail("first_publication_reservation_invalid");
  return record;
}

export function validateStoredFirstPublicationTerminal(record) {
  if (
    record?.state === "published" &&
    exactKeys(record, ["reservationId", "reservationDigest", "state", "executionReceiptDigest"]) &&
    reservationIdPattern.test(record.reservationId ?? "") &&
    digestPattern.test(record.reservationDigest ?? "") &&
    digestPattern.test(record.executionReceiptDigest ?? "")
  )
    return record;
  if (
    ["aborted_before_publication", "publication_unknown"].includes(record?.state) &&
    exactKeys(record, ["reservationId", "reservationDigest", "state", "retry"]) &&
    reservationIdPattern.test(record.reservationId ?? "") &&
    digestPattern.test(record.reservationDigest ?? "") &&
    record.retry ===
      (record.state === "publication_unknown" ? "forbidden" : "new_bootstrap_required")
  )
    return record;
  fail("first_publication_terminal_invalid");
}

export function createFirstPublicationTerminalEnvelope(record) {
  validateStoredFirstPublicationTerminal(record);
  return {
    schemaVersion: 1,
    record: structuredClone(record),
    recordDigest: canonicalDigest(record),
  };
}

export function validateFirstPublicationTerminalEnvelope(envelope) {
  if (
    !exactKeys(envelope, ["schemaVersion", "record", "recordDigest"]) ||
    envelope.schemaVersion !== 1 ||
    !digestPattern.test(envelope.recordDigest ?? "") ||
    envelope.recordDigest !== canonicalDigest(envelope.record)
  )
    fail("first_publication_store_corrupt");
  return validateStoredFirstPublicationTerminal(envelope.record);
}
