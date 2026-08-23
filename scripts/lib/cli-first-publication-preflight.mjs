import { isAbsolute, resolve } from "node:path";

import { createFileFirstPublicationReservationStore } from
  "./file-first-publication-reservation-store.mjs";
import { createFirstPublicationArtifactObservation } from
  "./first-publication-artifact-observer.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { readFirstPublicationContractFiles } from
  "./first-publication-contract-files.mjs";
import { inspectFirstPublicationPreflight } from
  "./first-publication-preflight-inspector.mjs";
import { validateFirstPublicationPreflightReport } from
  "./first-publication-preflight.mjs";
import { observeNpmInteractiveFirstPublication } from
  "./npm-interactive-first-publication-observer.mjs";
import { observeNpmPublicPackage } from "./npm-public-package-observer.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
  releaseVerificationMaximumSizes,
} from "./release-attestation-file-set.mjs";

function fail(code = "first_publication_preflight_input_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication preflight input is invalid.",
  );
}

async function readPreflightSources(options) {
  const contracts = await readFirstPublicationContractFiles(options);
  const { publicationAuthorization, bootstrap } = contracts;
  const tarballPath = resolve(options.releaseDirectory, publicationAuthorization.artifact.file);
  const tarballContents = await readRegularReleaseFile(
    tarballPath,
    releaseVerificationMaximumSizes.tarball,
  );
  return {
    publicationAuthorization,
    bootstrap,
    tarballContents,
    assertUnchanged: async () => {
      await contracts.assertUnchanged();
      await assertReleaseFilesUnchanged([{
        path: tarballPath,
        contents: tarballContents,
        maximumSize: releaseVerificationMaximumSizes.tarball,
      }]);
    },
  };
}

export async function checkCliFirstPublicationPreflight(options, dependencies = {}) {
  if (
    options?.online !== true ||
    !isAbsolute(options.releaseDirectory ?? "") ||
    !isAbsolute(options.publicationAuthorizationPath ?? "") ||
    !isAbsolute(options.bootstrapPath ?? "") ||
    !isAbsolute(options.reservationRoot ?? "") ||
    !isAbsolute(options.userConfigPath ?? "")
  ) fail(options?.online === true ? undefined : "first_publication_preflight_online_required");
  const readSources = dependencies.readSources ?? readPreflightSources;
  const observePackage = dependencies.observeNpmPublicPackage ?? observeNpmPublicPackage;
  const observeNpm = dependencies.observeNpmInteractiveFirstPublication ??
    observeNpmInteractiveFirstPublication;
  const createReservationStore = dependencies.createReservationStore ??
    createFileFirstPublicationReservationStore;
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const sources = await readSources(options);
  const { report, evidence } = await inspectFirstPublicationPreflight({
    bootstrap: sources.bootstrap,
    publicationAuthorization: sources.publicationAuthorization,
    releaseDirectory: options.releaseDirectory,
  }, {
    reservationStore: createReservationStore({ rootDirectory: options.reservationRoot }),
    observePackage,
    observeNpm: () => observeNpm({
      registry: sources.bootstrap.target.registry,
      userConfigPath: options.userConfigPath,
    }),
    observeArtifact: async () => createFirstPublicationArtifactObservation(
      sources.publicationAuthorization,
      sources.tarballContents,
    ),
    clock,
  });
  validateFirstPublicationPreflightReport(report, evidence);
  await sources.assertUnchanged();
  return report;
}
