import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateFirstPublicationBootstrapAuthorization } from "./first-publication-bootstrap-reader.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { createFirstPublicationTransitionReport } from "./first-publication-transition-policy.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const registryIntegrityPattern = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const registryShasumPattern = /^[a-f0-9]{40}$/u;

function fail(code = "first_publication_transition_receipt_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication transition receipt is invalid.",
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

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
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
    schemaVersion:
      transitionReport.publicationEvidence.type === "stage_approval_reconciliation" ? 3 : 2,
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
    bootstrap,
    armingAuthorization,
    publicationAuthorization,
    publicationEvidence,
    publicReleaseObservation,
    workflow,
    npmObservation,
    githubObservation,
  },
) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  validateFirstPublicationTransitionReceiptDocument(receipt);
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

export function validateFirstPublicationTransitionReceiptDocument(receipt) {
  const receiptBody = body(receipt ?? {});
  const evidence = receipt?.publicationEvidence;
  const publicRelease = receipt?.publicRelease;
  const transition = receipt?.transition;
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    canonicalJson(Object.keys(receipt).sort()) !==
      canonicalJson([...Object.keys(receiptBody), "transitionReceiptDigest"].sort()) ||
    ![2, 3].includes(receipt.schemaVersion) ||
    receipt.status !== "completed" ||
    !exactKeys(receipt.bootstrap, ["state", "bootstrapDigest"]) ||
    receipt.bootstrap.state !== "consumed" ||
    !digestPattern.test(receipt.bootstrap.bootstrapDigest ?? "") ||
    !exactKeys(evidence, ["type", "digest", "evidenceAt", "basis"]) ||
    !["execution_receipt", "reconciliation_resolution", "stage_approval_reconciliation"].includes(
      evidence.type,
    ) ||
    (receipt.schemaVersion === 3) !== (evidence.type === "stage_approval_reconciliation") ||
    !digestPattern.test(evidence.digest ?? "") ||
    (evidence.type === "execution_receipt" && evidence.basis !== "publisher_receipt_verified") ||
    (evidence.type === "reconciliation_resolution" &&
      evidence.basis !== "public_registry_reconciliation_reviewed") ||
    (evidence.type === "stage_approval_reconciliation" &&
      evidence.basis !== "npm_stage_approval_reconciliation_verified") ||
    !exactKeys(publicRelease, ["observedAt", "target", "artifact"]) ||
    !exactKeys(publicRelease.target, ["registry", "package", "version", "distTag", "access"]) ||
    publicRelease.target.registry !== npmPublicRegistry ||
    publicRelease.target.package !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(publicRelease.target.version ?? "") ||
    !["latest", "next"].includes(publicRelease.target.distTag) ||
    publicRelease.target.access !== "public" ||
    !exactKeys(publicRelease.artifact, ["registryIntegrity", "registryShasum"]) ||
    !registryIntegrityPattern.test(publicRelease.artifact.registryIntegrity ?? "") ||
    !registryShasumPattern.test(publicRelease.artifact.registryShasum ?? "") ||
    !exactKeys(transition, [
      "completedAt",
      "reportDigest",
      "mode",
      "workflow",
      "environment",
      "permission",
      "directPublish",
    ]) ||
    !digestPattern.test(transition.reportDigest ?? "") ||
    transition.mode !== "trusted_publisher_stage_only" ||
    transition.workflow !== "cli-release-matrix.yml" ||
    transition.environment !== "npm-release" ||
    transition.permission !== "createStagedPackage" ||
    transition.directPublish !== "forbidden" ||
    timestamp(publicRelease.observedAt) < timestamp(evidence.evidenceAt) ||
    transition.completedAt !== publicRelease.observedAt ||
    !digestPattern.test(receipt.transitionReceiptDigest ?? "") ||
    receipt.transitionReceiptDigest !== canonicalDigest(receiptBody)
  )
    fail();
  return receipt;
}
