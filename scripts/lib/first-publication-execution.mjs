import { isAbsolute } from "node:path";

import { canonicalJson } from "./release-artifact-manifest.mjs";
import { createFirstPublicationExecutionReceipt } from
  "./first-publication-execution-receipt.mjs";
import { createFirstPublicationReservation } from
  "./first-publication-reservation.mjs";
import { executeAuthorizedReleasePublication } from "./release-publication-executor.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { validateFirstPublicationArmingAuthorization } from
  "./first-publication-arming-authorization.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateReleasePublicationAuthorization } from
  "./release-publication-authorization.mjs";

function fail(code, message = "The CLI first-publication execution input is invalid.") {
  throw new FirstPublicationBootstrapError(code, message);
}

async function markUnknown(store, reservation) {
  try {
    await store.markUnknown({
      reservationId: reservation.reservationId,
      reservationDigest: reservation.reservationDigest,
      state: "publication_unknown",
      retry: "forbidden",
    });
  } catch {
    // The durable reservation still makes a blind duplicate unsafe.
  }
}

async function abortBeforePublication(store, reservation) {
  const aborted = {
    reservationId: reservation.reservationId,
    reservationDigest: reservation.reservationDigest,
    state: "aborted_before_publication",
    retry: "new_bootstrap_required",
  };
  try {
    if (canonicalJson(await store.abort(aborted)) !== canonicalJson(aborted)) {
      throw new Error("invalid abort");
    }
  } catch {
    fail(
      "first_publication_reservation_failed",
      "The pre-publication interruption state could not be saved.",
    );
  }
}

export async function executeFirstPublicationBootstrap(
  { bootstrap, armingAuthorization, publicationAuthorization, releaseDirectory },
  {
    reservationStore,
    observePackage,
    preparePublish,
    publish,
    clock = () => new Date().toISOString(),
  },
) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  const authorization = validateReleasePublicationAuthorization(publicationAuthorization);
  if (
    authorization.authorizationDigest !== bootstrap.release.publicationAuthorizationDigest ||
    typeof releaseDirectory !== "string" || !isAbsolute(releaseDirectory) ||
    typeof observePackage !== "function" || typeof publish !== "function" ||
    (preparePublish !== undefined && typeof preparePublish !== "function") ||
    typeof reservationStore?.reserve !== "function" ||
    typeof reservationStore.complete !== "function" ||
    typeof reservationStore.abort !== "function" ||
    typeof reservationStore.markUnknown !== "function"
  ) fail("first_publication_execution_input_invalid");
  validateFirstPublicationArmingAuthorization(armingAuthorization, {
    bootstrap,
    publicationAuthorization: authorization,
    checkedAt: clock(),
  });
  if (preparePublish !== undefined) await preparePublish();
  const observation = await observePackage();
  if (
    observation?.schemaVersion !== 1 || observation.source !== "npm_public_registry" ||
    observation.state !== "not_found" || observation.package !== bootstrap.target.package
  ) fail("first_publication_package_not_available");
  const reservedAt = clock();
  validateFirstPublicationArmingAuthorization(armingAuthorization, {
    bootstrap,
    publicationAuthorization: authorization,
    checkedAt: reservedAt,
  });
  const reservation = createFirstPublicationReservation({
    bootstrap,
    armingAuthorization,
    publicationAuthorization: authorization,
    reservedAt,
  });
  try {
    if (canonicalJson(await reservationStore.reserve(reservation)) !== canonicalJson(reservation)) {
      fail("first_publication_reservation_invalid");
    }
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail("first_publication_reservation_failed", "The CLI first-publication reservation could not be acquired.");
  }
  let publicationStarted = false;
  let publicationReport;
  try {
    publicationReport = await executeAuthorizedReleasePublication({
      authorization,
      releaseDirectory,
    }, {
      publish: async (input) => {
        publicationStarted = true;
        return publish(input);
      },
    });
  } catch (error) {
    if (!publicationStarted) {
      await abortBeforePublication(reservationStore, reservation);
      throw error;
    }
    await markUnknown(reservationStore, reservation);
    fail(
      "first_publication_outcome_unknown",
      "The CLI first-publication result is ambiguous; the same bootstrap must not be retried.",
    );
  }
  try {
    const receipt = createFirstPublicationExecutionReceipt({
      bootstrap,
      armingAuthorization,
      publicationAuthorization: authorization,
      reservation,
      publicationReport,
      publishedAt: clock(),
    });
    const completion = {
      reservationId: reservation.reservationId,
      reservationDigest: reservation.reservationDigest,
      state: "published",
      executionReceiptDigest: receipt.executionReceiptDigest,
    };
    if (canonicalJson(await reservationStore.complete(completion)) !== canonicalJson(completion)) {
      throw new Error("invalid completion");
    }
    return receipt;
  } catch {
    await markUnknown(reservationStore, reservation);
    fail(
      "first_publication_outcome_unknown",
      "The CLI first-publication result is ambiguous; the same bootstrap must not be retried.",
    );
  }
}
