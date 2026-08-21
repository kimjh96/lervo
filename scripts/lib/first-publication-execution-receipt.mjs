import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import {
  validateFirstPublicationReservation,
} from "./first-publication-reservation.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_execution_receipt_invalid",
    "CLI 최초 게시 실행 영수증이 올바르지 않습니다.",
  );
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
}

function body(receipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    status: receipt.status,
    bootstrapDigest: receipt.bootstrapDigest,
    reservation: receipt.reservation,
    publication: receipt.publication,
    transition: receipt.transition,
  };
}

export function createFirstPublicationExecutionReceipt({
  bootstrap,
  reservation,
  publicationReport,
  publishedAt,
}) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  validateFirstPublicationReservation(reservation, bootstrap);
  if (
    timestamp(publishedAt) < timestamp(reservation.reservedAt) ||
    publicationReport?.schemaVersion !== 1 || publicationReport.status !== "published" ||
    publicationReport.authorizationDigest !== bootstrap.release.publicationAuthorizationDigest ||
    canonicalJson(publicationReport.receipt) !== canonicalJson({
      registry: bootstrap.target.registry,
      package: bootstrap.target.package,
      version: bootstrap.target.version,
      distTag: bootstrap.target.distTag,
      registryIntegrity: bootstrap.release.artifact.registryIntegrity,
      registryShasum: bootstrap.release.artifact.registryShasum,
    })
  ) fail();
  const receiptBody = {
    schemaVersion: 1,
    status: "published_transition_pending",
    bootstrapDigest: bootstrap.bootstrapDigest,
    reservation: {
      reservationId: reservation.reservationId,
      reservationDigest: reservation.reservationDigest,
      reservedAt: reservation.reservedAt,
    },
    publication: {
      authorizationDigest: publicationReport.authorizationDigest,
      publishedAt,
      receipt: structuredClone(publicationReport.receipt),
    },
    transition: {
      state: "pending",
      required: structuredClone(bootstrap.transition),
    },
  };
  return { ...receiptBody, executionReceiptDigest: canonicalDigest(receiptBody) };
}

export function validateFirstPublicationExecutionReceipt(receipt, bootstrap) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  const receiptBody = body(receipt ?? {});
  if (
    receipt === null || typeof receipt !== "object" || Array.isArray(receipt) ||
    canonicalJson(Object.keys(receipt).sort()) !==
      canonicalJson([...Object.keys(receiptBody), "executionReceiptDigest"].sort()) ||
    receipt.schemaVersion !== 1 || receipt.status !== "published_transition_pending" ||
    receipt.bootstrapDigest !== bootstrap.bootstrapDigest ||
    !digestPattern.test(receipt.executionReceiptDigest ?? "") ||
    receipt.executionReceiptDigest !== canonicalDigest(receiptBody) ||
    receipt.transition?.state !== "pending" ||
    canonicalJson(receipt.transition.required) !== canonicalJson(bootstrap.transition)
  ) fail();
  const reservation = {
    schemaVersion: 1,
    reservationId: receipt.reservation?.reservationId,
    state: "reserved",
    bootstrapDigest: bootstrap.bootstrapDigest,
    publicationAuthorizationDigest: bootstrap.release.publicationAuthorizationDigest,
    artifactSha256: bootstrap.release.artifact.sha256,
    reservedAt: receipt.reservation?.reservedAt,
    reservationDigest: receipt.reservation?.reservationDigest,
  };
  validateFirstPublicationReservation(reservation, bootstrap);
  createFirstPublicationExecutionReceipt({
    bootstrap,
    reservation,
    publicationReport: {
      schemaVersion: 1,
      status: "published",
      authorizationDigest: receipt.publication?.authorizationDigest,
      receipt: receipt.publication?.receipt,
    },
    publishedAt: receipt.publication?.publishedAt,
  });
  return receipt;
}
