import { observeFirstPublicationArtifact } from
  "./first-publication-artifact-observer.mjs";
import { createFirstPublicationPreflightReport } from
  "./first-publication-preflight.mjs";
import { firstPublicationReservationId } from "./first-publication-reservation.mjs";

export async function inspectFirstPublicationPreflight({
  bootstrap,
  publicationAuthorization,
  releaseDirectory,
}, {
  reservationStore,
  observePackage,
  observeNpm,
  clock = () => new Date().toISOString(),
}) {
  if (
    typeof reservationStore?.observe !== "function" ||
    typeof observePackage !== "function" ||
    typeof observeNpm !== "function" ||
    typeof clock !== "function"
  ) throw new TypeError("first-publication preflight inspector ports are invalid");
  const reservationId = firstPublicationReservationId(bootstrap);
  const [artifactObservation, packageObservation, reservationObservation, npmObservation] =
    await Promise.all([
      observeFirstPublicationArtifact({ publicationAuthorization, releaseDirectory }),
      observePackage(),
      reservationStore.observe(reservationId).catch(() => ({
        schemaVersion: 1,
        source: "first_publication_reservation_store",
        state: "unavailable",
        reservationId,
        reason: "reservation_store_unavailable",
      })),
      observeNpm(),
    ]);
  const checkedAt = clock();
  const evidence = {
    bootstrap,
    publicationAuthorization,
    artifactObservation,
    packageObservation,
    reservationObservation,
    npmObservation,
    checkedAt,
  };
  return {
    report: createFirstPublicationPreflightReport(evidence),
    evidence,
  };
}
