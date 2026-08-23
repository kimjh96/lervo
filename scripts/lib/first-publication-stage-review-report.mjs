import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationStageResultReportDocument } from
  "./first-publication-stage-result-report.mjs";
import { validateCliReleaseTag } from "./cli-release-attestation.mjs";
import {
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "./first-publication-workflow-reachability-contract.mjs";
import { remoteReleaseWorkflowPath } from
  "./first-publication-workflow-remote-source-contract.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const sha1Pattern = /^[a-f0-9]{40}$/u;
const integrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const checkIds = Object.freeze([
  "stage_result_evidence",
  "exact_staged_version_unique",
  "stage_list_view_consistent",
  "staged_tarball_downloaded",
  "exact_tarball_integrity",
  "stage_metadata_stable",
  "approval_not_attempted",
]);

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_stage_review_report_invalid",
    "The CLI npm staged-package review evidence report is invalid.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function validTimestamp(value) {
  return typeof value === "string" && timestampPattern.test(value) &&
    Number.isFinite(Date.parse(value));
}

export function createFirstPublicationStageReviewReport({
  stageResultReport,
  observation,
  observedAt,
}) {
  const body = {
    schemaVersion: 2,
    status: "evidence_bound",
    evidenceType: "first_publication_npm_staged_package_review",
    target: structuredClone(stageResultReport.target),
    upstream: {
      stageResultEvidenceDigest: stageResultReport.evidenceDigest,
      stageResultObservedAt: stageResultReport.github.observedAt,
      workflowExecutionEvidenceDigest:
        stageResultReport.upstream.workflowExecutionEvidenceDigest,
      publicationAuthorizationDigest: stageResultReport.stage.authorizationDigest,
    },
    npm: {
      observedAt,
      registry: observation.registry,
      stage: structuredClone(observation.stage),
      tarball: structuredClone(observation.tarball),
      metadataStability: observation.metadataStability,
      userConfig: observation.userConfig,
      temporaryFiles: observation.temporaryFiles,
    },
    checks: checkIds.map((id) => ({ id, status: "ready" })),
    review: "exact_staged_package_and_tarball_observed",
    limitations: {
      upstreamEvidenceAuthenticity: "not_verified",
      npmAuthenticationOwnership: "not_verified",
      stagedPackageAfterObservation: "not_verified",
      twoFactorApproval: "not_observed",
      publicAvailability: "not_observed",
    },
    sideEffects: {
      files: "not_changed",
      npmSettings: "observed_not_changed",
      temporaryFiles: "removed",
      stageList: "performed_read_only",
      stageView: "performed_read_only",
      stageDownload: "performed_read_only",
      stageApprove: "not_attempted",
      stageReject: "not_attempted",
      publication: "not_attempted",
    },
  };
  return { ...body, evidenceDigest: canonicalDigest(body) };
}

export function validateFirstPublicationStageReviewReportDocument(report) {
  const npm = report?.npm;
  const stage = npm?.stage;
  const tarball = npm?.tarball;
  const target = report?.target;
  const limitations = {
    upstreamEvidenceAuthenticity: "not_verified",
    npmAuthenticationOwnership: "not_verified",
    stagedPackageAfterObservation: "not_verified",
    twoFactorApproval: "not_observed",
    publicAvailability: "not_observed",
  };
  const sideEffects = {
    files: "not_changed",
    npmSettings: "observed_not_changed",
    temporaryFiles: "removed",
    stageList: "performed_read_only",
    stageView: "performed_read_only",
    stageDownload: "performed_read_only",
    stageApprove: "not_attempted",
    stageReject: "not_attempted",
    publication: "not_attempted",
  };
  let validTarget = false;
  try {
    validateReadinessRepository(target?.repository);
    validateWorkflowReachabilityCommit(target?.sourceCommit);
    validateWorkflowReachabilityReleaseTag(target?.releaseTag);
    validateCliReleaseTag(target?.version, target?.releaseTag);
    validTarget = exactKeys(target, [
      "repository", "sourceCommit", "releaseTag", "package", "version",
      "workflowPath", "runId", "attempt",
    ]) && target.package === "@lervo/cli" &&
      target.workflowPath === remoteReleaseWorkflowPath &&
      Number.isSafeInteger(target.runId) && target.runId > 0 &&
      Number.isSafeInteger(target.attempt) && target.attempt > 0;
  } catch {
    validTarget = false;
  }
  const validChecks = Array.isArray(report?.checks) &&
    report.checks.length === checkIds.length && report.checks.every((check, index) =>
      exactKeys(check, ["id", "status"]) && check.id === checkIds[index] &&
      check.status === "ready"
    );
  const validStage = exactKeys(stage, ["idDigest", "createdAt", "distTag", "shasum"]) &&
    digestPattern.test(stage?.idDigest ?? "") && validTimestamp(stage?.createdAt) &&
    ["latest", "next"].includes(stage?.distTag) && sha1Pattern.test(stage?.shasum ?? "");
  const validTarball = exactKeys(tarball, [
    "byteCount", "sha256", "registryIntegrity", "registryShasum",
  ]) && Number.isSafeInteger(tarball?.byteCount) && tarball.byteCount > 0 &&
    /^[a-f0-9]{64}$/u.test(tarball.sha256 ?? "") &&
    integrityPattern.test(tarball.registryIntegrity ?? "") &&
    sha1Pattern.test(tarball.registryShasum ?? "") && tarball.registryShasum === stage?.shasum;
  const validUpstream = exactKeys(report?.upstream, report?.schemaVersion === 2
    ? [
        "stageResultEvidenceDigest", "stageResultObservedAt",
        "workflowExecutionEvidenceDigest", "publicationAuthorizationDigest",
      ]
    : [
        "stageResultEvidenceDigest", "stageResultObservedAt",
        "workflowExecutionEvidenceDigest",
      ]) && digestPattern.test(report?.upstream?.stageResultEvidenceDigest ?? "") &&
    digestPattern.test(report?.upstream?.workflowExecutionEvidenceDigest ?? "") &&
    (report?.schemaVersion === 1 ||
      digestPattern.test(report?.upstream?.publicationAuthorizationDigest ?? "")) &&
    validTimestamp(report?.upstream?.stageResultObservedAt);
  if (
    !exactKeys(report, [
      "schemaVersion", "status", "evidenceType", "target", "upstream", "npm",
      "checks", "review", "limitations", "sideEffects", "evidenceDigest",
    ]) || ![1, 2].includes(report.schemaVersion) || report.status !== "evidence_bound" ||
    report.evidenceType !== "first_publication_npm_staged_package_review" ||
    report.review !== "exact_staged_package_and_tarball_observed" ||
    !validTarget ||
    !validUpstream ||
    !exactKeys(npm, [
      "observedAt", "registry", "stage", "tarball", "metadataStability",
      "userConfig", "temporaryFiles",
    ]) || !validTimestamp(npm.observedAt) ||
    Date.parse(npm.observedAt) < Date.parse(report.upstream.stageResultObservedAt) ||
    npm.registry !== "https://registry.npmjs.org/" ||
    npm.metadataStability !== "rechecked_unchanged" ||
    npm.userConfig !== "rechecked_unchanged" || npm.temporaryFiles !== "removed" ||
    !validStage || !validTarball || tarball.byteCount > 64 * 1024 * 1024 ||
    !validChecks ||
    !exactKeys(report.limitations, Object.keys(limitations)) ||
    canonicalJson(report.limitations) !== canonicalJson(limitations) ||
    !exactKeys(report.sideEffects, Object.keys(sideEffects)) ||
    canonicalJson(report.sideEffects) !== canonicalJson(sideEffects) ||
    !digestPattern.test(report.evidenceDigest ?? "")
  ) fail();
  const { evidenceDigest, ...body } = report;
  if (evidenceDigest !== canonicalDigest(body)) fail();
  return report;
}

export function validateStageReviewUpstreamReport(report) {
  return validateFirstPublicationStageResultReportDocument(report);
}
