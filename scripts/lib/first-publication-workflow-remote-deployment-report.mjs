import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  maximumRemoteWorkflowBytes,
  remoteReleaseWorkflowPath,
  validateRemoteWorkflowSourceCommit,
} from "./first-publication-workflow-remote-source-contract.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import {
  trustedPublisherEnvironment,
  validateReadinessRepository,
} from "./trusted-publisher-readiness.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const blobShaPattern = /^[a-f0-9]{40}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const checkIds = Object.freeze([
  "transaction_state",
  "post_apply_report",
  "local_workflow",
  "remote_workflow_at_source_commit",
  "exact_workflow_bytes",
  "stage_only_workflow",
]);

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_remote_deployment_report_invalid",
    "The CLI stage-only workflow remote-deployment evidence report is invalid.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const result = Date.parse(value);
  if (!Number.isFinite(result)) fail();
  return result;
}

export function createFirstPublicationWorkflowRemoteDeploymentReport({
  repository,
  sourceCommit,
  postApplyReport,
  workflowSnapshot,
  remoteObservation,
  observedAt,
}) {
  const body = {
    schemaVersion: 1,
    status: "evidence_bound",
    evidenceType: "first_publication_stage_only_workflow_remote_source",
    target: {
      repository,
      sourceCommit,
      workflowPath: remoteReleaseWorkflowPath,
      package: postApplyReport.target.package,
      environment: postApplyReport.target.environment,
    },
    local: {
      postApplyReportDigest: postApplyReport.reportDigest,
      postApplyObservedAt: postApplyReport.observedAt,
      workflowSha256: workflowSnapshot.sha256,
    },
    remote: {
      source: "github_repository_workflow",
      observedAt,
      gitBlobSha: remoteObservation.blobSha,
      byteCount: remoteObservation.byteCount,
      sha256: remoteObservation.sha256,
    },
    checks: checkIds.map((id) => ({ id, status: "ready" })),
    remoteSource: "exact_workflow_present_at_source_commit",
    limitations: {
      localReportAuthenticity: "not_verified",
      sourceCommitReachability: "exact_commit_only",
      defaultBranch: "not_verified",
      releaseTag: "not_verified",
      workflowExecution: "not_observed",
      stageSubmission: "not_observed",
      publicAvailability: "not_observed",
    },
    sideEffects: {
      files: "not_changed",
      githubSettings: "not_changed",
      workflowDispatch: "not_attempted",
      publication: "not_attempted",
    },
  };
  return { ...body, evidenceDigest: canonicalDigest(body) };
}

export function validateFirstPublicationWorkflowRemoteDeploymentReportDocument(report) {
  try {
    validateReadinessRepository(report?.target?.repository);
    validateRemoteWorkflowSourceCommit(report?.target?.sourceCommit);
  } catch {
    fail();
  }
  const validTarget = exactKeys(report.target, [
    "repository", "sourceCommit", "workflowPath", "package", "environment",
  ]) && report.target.workflowPath === remoteReleaseWorkflowPath &&
    report.target.package === "@lervo/cli" &&
    report.target.environment === trustedPublisherEnvironment;
  const validLocal = exactKeys(report.local, [
    "postApplyReportDigest", "postApplyObservedAt", "workflowSha256",
  ]) && digestPattern.test(report.local.postApplyReportDigest ?? "") &&
    digestPattern.test(report.local.workflowSha256 ?? "");
  const validRemote = exactKeys(report.remote, [
    "source", "observedAt", "gitBlobSha", "byteCount", "sha256",
  ]) && report.remote.source === "github_repository_workflow" &&
    blobShaPattern.test(report.remote.gitBlobSha ?? "") &&
    Number.isSafeInteger(report.remote.byteCount) && report.remote.byteCount > 0 &&
    report.remote.byteCount <= maximumRemoteWorkflowBytes &&
    digestPattern.test(report.remote.sha256 ?? "") &&
    report.remote.sha256 === report.local.workflowSha256;
  const validChecks = Array.isArray(report.checks) &&
    report.checks.length === checkIds.length && report.checks.every((check, index) =>
      exactKeys(check, ["id", "status"]) && check.id === checkIds[index] &&
      check.status === "ready"
    );
  const validLimitations = exactKeys(report.limitations, [
    "localReportAuthenticity", "sourceCommitReachability", "defaultBranch",
    "releaseTag", "workflowExecution", "stageSubmission", "publicAvailability",
  ]) && canonicalJson(report.limitations) === canonicalJson({
    localReportAuthenticity: "not_verified",
    sourceCommitReachability: "exact_commit_only",
    defaultBranch: "not_verified",
    releaseTag: "not_verified",
    workflowExecution: "not_observed",
    stageSubmission: "not_observed",
    publicAvailability: "not_observed",
  });
  const validSideEffects = exactKeys(report.sideEffects, [
    "files", "githubSettings", "workflowDispatch", "publication",
  ]) && canonicalJson(report.sideEffects) === canonicalJson({
    files: "not_changed",
    githubSettings: "not_changed",
    workflowDispatch: "not_attempted",
    publication: "not_attempted",
  });
  if (
    !exactKeys(report, [
      "schemaVersion", "status", "evidenceType", "target", "local", "remote",
      "checks", "remoteSource", "limitations", "sideEffects", "evidenceDigest",
    ]) || report.schemaVersion !== 1 || report.status !== "evidence_bound" ||
    report.evidenceType !== "first_publication_stage_only_workflow_remote_source" ||
    report.remoteSource !== "exact_workflow_present_at_source_commit" ||
    !validTarget || !validLocal || !validRemote || !validChecks ||
    !validLimitations || !validSideEffects ||
    !digestPattern.test(report.evidenceDigest ?? "") ||
    timestamp(report.remote.observedAt) < timestamp(report.local.postApplyObservedAt)
  ) fail();
  const { evidenceDigest, ...body } = report;
  if (evidenceDigest !== canonicalDigest(body)) fail();
  return report;
}
