import { isAbsolute } from "node:path";

import { createFileFirstPublicationReservationStore } from "./file-first-publication-reservation-store.mjs";
import {
  validateFirstPublicationArmingAuthorization,
  validateFirstPublicationArmingAuthorizationDocument,
} from "./first-publication-arming-authorization.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { readFirstPublicationContractFiles } from "./first-publication-contract-files.mjs";
import {
  firstPublicationReservationId,
  validateFirstPublicationReservation,
} from "./first-publication-reservation.mjs";
import { validateStoredFirstPublicationTerminal } from "./first-publication-store-records.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";

const maximumInputBytes = 64 * 1024;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_reconciliation_source_invalid",
    "The CLI first-publication reconciliation source is invalid.",
  );
}

function parseJson(contents) {
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch {
    fail();
  }
}

function validateSnapshot(snapshot, sources) {
  const { bootstrap, armingAuthorization, publicationAuthorization } = sources;
  validateFirstPublicationReservation(snapshot?.reservation, {
    bootstrap,
    armingAuthorization,
    publicationAuthorization,
  });
  validateStoredFirstPublicationTerminal(snapshot?.terminal);
  if (
    snapshot.terminal.state !== "publication_unknown" ||
    snapshot.terminal.retry !== "forbidden" ||
    snapshot.terminal.reservationId !== snapshot.reservation.reservationId ||
    snapshot.terminal.reservationDigest !== snapshot.reservation.reservationDigest
  )
    fail();
  return snapshot;
}

export async function readFirstPublicationReconciliationSources(options, dependencies = {}) {
  if (
    !isAbsolute(options?.publicationAuthorizationPath ?? "") ||
    !isAbsolute(options?.bootstrapPath ?? "") ||
    !isAbsolute(options?.armingAuthorizationPath ?? "") ||
    !isAbsolute(options?.reservationRoot ?? "")
  )
    fail();
  const contracts = await readFirstPublicationContractFiles(options);
  let armingContents;
  try {
    armingContents = await readRegularReleaseFile(
      options.armingAuthorizationPath,
      maximumInputBytes,
    );
  } catch {
    fail();
  }
  const armingAuthorization = validateFirstPublicationArmingAuthorizationDocument(
    parseJson(armingContents),
  );
  validateFirstPublicationArmingAuthorization(armingAuthorization, {
    ...contracts,
    checkedAt: armingAuthorization.validity.armedAt,
  });
  const createStore =
    dependencies.createReservationStore ?? createFileFirstPublicationReservationStore;
  const store = createStore({ rootDirectory: options.reservationRoot });
  const reservationId = firstPublicationReservationId(contracts.bootstrap);
  let snapshot;
  try {
    snapshot = validateSnapshot(await store.inspect(reservationId), {
      ...contracts,
      armingAuthorization,
    });
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
  return {
    bootstrap: contracts.bootstrap,
    publicationAuthorization: contracts.publicationAuthorization,
    armingAuthorization,
    reservation: snapshot.reservation,
    terminal: snapshot.terminal,
    assertUnchanged: async () => {
      await Promise.all([
        contracts.assertUnchanged(),
        assertReleaseFilesUnchanged([
          {
            path: options.armingAuthorizationPath,
            contents: armingContents,
            maximumSize: maximumInputBytes,
          },
        ]),
      ]);
      const current = validateSnapshot(await store.inspect(reservationId), {
        ...contracts,
        armingAuthorization,
      });
      if (canonicalJson(current) !== canonicalJson(snapshot)) {
        throw new FirstPublicationBootstrapError(
          "first_publication_reconciliation_source_changed",
          "The CLI first-publication reconciliation source changed during reconciliation.",
        );
      }
    },
  };
}
