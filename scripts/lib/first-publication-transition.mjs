import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { createFirstPublicationTransitionReport } from
  "./first-publication-transition-policy.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function fail(code = "first_publication_transition_receipt_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI 최초 게시 전환 영수증이 올바르지 않습니다.",
  );
}

function body(receipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    status: receipt.status,
    bootstrap: receipt.bootstrap,
    publicationEvidence: receipt.publicationEvidence,
    publicRelease: receipt.publicRelease,
    transition: receipt.transition,
  };
}

export function createFirstPublicationTransitionReceipt({
  bootstrap,
  armingAuthorization,
  publicationAuthorization,
  publicationEvidence,
  publicReleaseObservation,
  workflow,
  npmObservation,
  githubObservation,
  completedAt,
}) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  const transitionReport = createFirstPublicationTransitionReport({
    bootstrap,
    armingAuthorization,
    publicationAuthorization,
    publicationEvidence,
    publicReleaseObservation,
    workflow,
    npmObservation,
    githubObservation,
    observedAt: completedAt,
  });
  if (transitionReport.status !== "ready") fail("first_publication_transition_not_ready");
  const receiptBody = {
    schemaVersion: 2,
    status: "completed",
    bootstrap: {
      state: "consumed",
      bootstrapDigest: bootstrap.bootstrapDigest,
    },
    publicationEvidence: structuredClone(transitionReport.publicationEvidence),
    publicRelease: {
      observedAt: transitionReport.observedAt,
      target: structuredClone(bootstrap.target),
      artifact: {
        registryIntegrity: bootstrap.release.artifact.registryIntegrity,
        registryShasum: bootstrap.release.artifact.registryShasum,
      },
    },
    transition: {
      completedAt: transitionReport.observedAt,
      reportDigest: transitionReport.transitionReportDigest,
      mode: "trusted_publisher_stage_only",
      workflow: "cli-release-matrix.yml",
      environment: "npm-release",
      permission: "createStagedPackage",
      directPublish: "forbidden",
    },
  };
  return { ...receiptBody, transitionReceiptDigest: canonicalDigest(receiptBody) };
}

export function validateFirstPublicationTransitionReceipt(
  receipt,
  {
    bootstrap, armingAuthorization, publicationAuthorization, publicationEvidence,
    publicReleaseObservation, workflow, npmObservation, githubObservation,
  },
) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  const receiptBody = body(receipt ?? {});
  if (
    receipt === null || typeof receipt !== "object" || Array.isArray(receipt) ||
    canonicalJson(Object.keys(receipt).sort()) !==
      canonicalJson([...Object.keys(receiptBody), "transitionReceiptDigest"].sort()) ||
    receipt.schemaVersion !== 2 || receipt.status !== "completed" ||
    !digestPattern.test(receipt.transitionReceiptDigest ?? "") ||
    receipt.transitionReceiptDigest !== canonicalDigest(receiptBody)
  ) fail();
  const expected = createFirstPublicationTransitionReceipt({
    bootstrap,
    armingAuthorization,
    publicationAuthorization,
    publicationEvidence,
    publicReleaseObservation,
    workflow,
    npmObservation,
    githubObservation,
    completedAt: receipt?.transition?.completedAt,
  });
  if (canonicalJson(receipt) !== canonicalJson(expected)) fail();
  return receipt;
}
