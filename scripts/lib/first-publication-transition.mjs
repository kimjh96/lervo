import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { validateFirstPublicationExecutionReceipt } from
  "./first-publication-execution-receipt.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { createFirstPublicationTransitionReport } from
  "./first-publication-transition-policy.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const readyChecks = [
  { id: "stage_only_workflow", status: "ready", reasons: [] },
  { id: "npm_trusted_publisher", status: "ready", reasons: [] },
  { id: "github_environment", status: "ready", reasons: [] },
];

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
    executionReceiptDigest: receipt.executionReceiptDigest,
    publication: receipt.publication,
    transition: receipt.transition,
  };
}

function validateReadyReport(report, bootstrap, executionReceipt) {
  if (
    report?.schemaVersion !== 1 || report.status !== "ready" ||
    report.bootstrapDigest !== bootstrap.bootstrapDigest ||
    report.executionReceiptDigest !== executionReceipt.executionReceiptDigest ||
    !digestPattern.test(report.transitionReportDigest ?? "") ||
    report.transitionReportDigest !== canonicalDigest({
      schemaVersion: report.schemaVersion,
      status: report.status,
      bootstrapDigest: report.bootstrapDigest,
      executionReceiptDigest: report.executionReceiptDigest,
      observedAt: report.observedAt,
      checks: report.checks,
    }) ||
    canonicalJson(report.checks) !== canonicalJson(readyChecks) ||
    typeof report.observedAt !== "string" || !timestampPattern.test(report.observedAt) ||
    !Number.isFinite(Date.parse(report.observedAt)) ||
    Date.parse(report.observedAt) < Date.parse(executionReceipt.publication.publishedAt)
  ) fail("first_publication_transition_not_ready");
}

export function createFirstPublicationTransitionReceipt({
  bootstrap,
  armingAuthorization,
  publicationAuthorization,
  executionReceipt,
  workflow,
  npmObservation,
  githubObservation,
  completedAt,
}) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  validateFirstPublicationExecutionReceipt(executionReceipt, {
    bootstrap,
    armingAuthorization,
    publicationAuthorization,
  });
  const transitionReport = createFirstPublicationTransitionReport({
    bootstrap,
    armingAuthorization,
    publicationAuthorization,
    executionReceipt,
    workflow,
    npmObservation,
    githubObservation,
    observedAt: completedAt,
  });
  validateReadyReport(transitionReport, bootstrap, executionReceipt);
  const receiptBody = {
    schemaVersion: 1,
    status: "completed",
    bootstrap: {
      state: "consumed",
      bootstrapDigest: bootstrap.bootstrapDigest,
    },
    executionReceiptDigest: executionReceipt.executionReceiptDigest,
    publication: structuredClone(executionReceipt.publication),
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
    bootstrap, armingAuthorization, publicationAuthorization, executionReceipt,
    workflow, npmObservation, githubObservation,
  },
) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  validateFirstPublicationExecutionReceipt(executionReceipt, {
    bootstrap,
    armingAuthorization,
    publicationAuthorization,
  });
  const receiptBody = body(receipt ?? {});
  if (
    receipt === null || typeof receipt !== "object" || Array.isArray(receipt) ||
    canonicalJson(Object.keys(receipt).sort()) !==
      canonicalJson([...Object.keys(receiptBody), "transitionReceiptDigest"].sort()) ||
    receipt.schemaVersion !== 1 || receipt.status !== "completed" ||
    !digestPattern.test(receipt.transitionReceiptDigest ?? "") ||
    receipt.transitionReceiptDigest !== canonicalDigest(receiptBody)
  ) fail();
  const expected = createFirstPublicationTransitionReceipt({
    bootstrap,
    armingAuthorization,
    publicationAuthorization,
    executionReceipt,
    workflow,
    npmObservation,
    githubObservation,
    completedAt: receipt?.transition?.completedAt,
  });
  if (canonicalJson(receipt) !== canonicalJson(expected)) fail();
  return receipt;
}
