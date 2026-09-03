import { validateCliReleaseTag } from "../../lib/cli-release-attestation.mjs";
import { maximumStageResultArchiveBytes } from "../../lib/bounded-stage-result-archive.mjs";
import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import { validateFirstPublicationWorkflowExecutionReportDocument } from "../workflow/first-publication-workflow-execution-report.mjs";
import {
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "../workflow/first-publication-workflow-reachability-contract.mjs";
import { remoteReleaseWorkflowPath } from "../workflow/first-publication-workflow-remote-source-contract.mjs";
import { canonicalDigest, canonicalJson } from "../../../shared/release-artifact-manifest.mjs";
import { validateReadinessRepository } from "../../lib/trusted-publisher-readiness.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const checkIds = Object.freeze([
  "workflow_execution_evidence",
  "artifact_metadata_exact",
  "artifact_archive_digest",
  "archive_exact_stage_records",
  "stage_attempt_terminal_binding",
  "exact_package_version",
  "npm_cli_exit_zero",
]);

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_stage_result_report_invalid",
    "The CLI npm stage-result evidence report is invalid.",
  );
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function positive(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail();
  return parsed;
}

export function createFirstPublicationStageResultReport({
  workflowExecutionReport,
  stageResultObservation,
  stageResultRecords,
  observedAt,
}) {
  const { attempt, terminal } = stageResultRecords;
  const body = {
    schemaVersion: 1,
    status: "evidence_bound",
    evidenceType: "first_publication_npm_stage_result",
    target: structuredClone(workflowExecutionReport.target),
    upstream: {
      workflowExecutionEvidenceDigest: workflowExecutionReport.evidenceDigest,
      workflowExecutionObservedAt: workflowExecutionReport.github.observedAt,
      reachabilityEvidenceDigest: workflowExecutionReport.upstream.reachabilityEvidenceDigest,
    },
    github: {
      observedAt,
      artifact: structuredClone(stageResultObservation.artifact),
      archive: {
        byteCount: stageResultObservation.archive.byteCount,
        sha256: stageResultObservation.archive.sha256,
      },
      metadataStability: stageResultObservation.metadataStability,
    },
    stage: {
      state: terminal.state,
      operation: attempt.operation,
      attemptDigest: attempt.attemptDigest,
      authorizationDigest: attempt.authorizationDigest,
      reservedAt: attempt.reservedAt,
      completedAt: terminal.completedAt,
      target: structuredClone(attempt.target),
      artifact: structuredClone(attempt.artifact),
      receiptEvidence: terminal.receipt.evidence,
      review: terminal.review,
      publicAvailability: terminal.publicAvailability,
      retry: terminal.retry,
    },
    checks: checkIds.map((id) => ({ id, status: "ready" })),
    stageResult: "npm_cli_reported_stage_submission_accepted",
    limitations: {
      upstreamEvidenceAuthenticity: "not_verified",
      artifactAfterObservation: "not_verified",
      authorizationAuthenticity: "not_verified",
      npmStageSubmissionProof: "npm_cli_exit_zero_only",
      npmTwoFactorApproval: "not_observed",
      publicAvailability: "not_observed",
    },
    sideEffects: {
      files: "not_changed",
      githubSettings: "not_changed",
      artifactDownload: "performed_read_only",
      workflowDispatch: "not_attempted",
      workflowRerun: "not_attempted",
      publication: "not_attempted",
    },
  };
  return { ...body, evidenceDigest: canonicalDigest(body) };
}

export function validateFirstPublicationStageResultReportDocument(report) {
  const target = report?.target;
  const upstream = report?.upstream;
  const github = report?.github;
  const stage = report?.stage;
  try {
    validateReadinessRepository(target?.repository);
    validateWorkflowReachabilityCommit(target?.sourceCommit);
    validateWorkflowReachabilityReleaseTag(target?.releaseTag);
    validateCliReleaseTag(target?.version, target?.releaseTag);
  } catch {
    fail();
  }
  const validTarget =
    exactKeys(target, [
      "repository",
      "sourceCommit",
      "releaseTag",
      "package",
      "version",
      "workflowPath",
      "runId",
      "attempt",
    ]) &&
    target.package === "@lervo/cli" &&
    target.workflowPath === remoteReleaseWorkflowPath &&
    positive(target.runId) &&
    positive(target.attempt);
  const validUpstream =
    exactKeys(upstream, [
      "workflowExecutionEvidenceDigest",
      "workflowExecutionObservedAt",
      "reachabilityEvidenceDigest",
    ]) &&
    digestPattern.test(upstream.workflowExecutionEvidenceDigest ?? "") &&
    digestPattern.test(upstream.reachabilityEvidenceDigest ?? "");
  const artifact = github?.artifact;
  const validArtifact =
    exactKeys(artifact, [
      "id",
      "name",
      "sizeInBytes",
      "digest",
      "expired",
      "createdAt",
      "expiresAt",
    ]) &&
    positive(artifact.id) &&
    positive(artifact.sizeInBytes) &&
    artifact.name === `lervo-cli-stage-${target?.releaseTag}-${target?.attempt}` &&
    digestPattern.test(artifact.digest ?? "") &&
    artifact.expired === false &&
    timestamp(artifact.expiresAt) > timestamp(artifact.createdAt);
  const validArchive =
    exactKeys(github?.archive, ["byteCount", "sha256"]) &&
    positive(github.archive.byteCount) &&
    github.archive.byteCount <= maximumStageResultArchiveBytes &&
    github.archive.byteCount === artifact?.sizeInBytes &&
    github.archive.sha256 === artifact?.digest;
  const validGitHub =
    exactKeys(github, ["observedAt", "artifact", "archive", "metadataStability"]) &&
    validArtifact &&
    validArchive &&
    github.metadataStability === "rechecked_unchanged";
  const stageTarget = stage?.target;
  const stageArtifact = stage?.artifact;
  const validStageTarget =
    exactKeys(stageTarget, ["registry", "package", "version", "distTag", "access"]) &&
    stageTarget.registry === "https://registry.npmjs.org/" &&
    stageTarget.package === target?.package &&
    stageTarget.version === target?.version &&
    ["latest", "next"].includes(stageTarget.distTag) &&
    stageTarget.access === "public";
  const validStageArtifact =
    exactKeys(stageArtifact, ["file", "sha256", "registryIntegrity", "registryShasum"]) &&
    stageArtifact.file === `lervo-cli-${target?.version}.tgz` &&
    /^[a-f0-9]{64}$/u.test(stageArtifact.sha256 ?? "") &&
    /^sha512-[A-Za-z0-9+/]{86}==$/u.test(stageArtifact.registryIntegrity ?? "") &&
    /^[a-f0-9]{40}$/u.test(stageArtifact.registryShasum ?? "");
  const validStage =
    exactKeys(stage, [
      "state",
      "operation",
      "attemptDigest",
      "authorizationDigest",
      "reservedAt",
      "completedAt",
      "target",
      "artifact",
      "receiptEvidence",
      "review",
      "publicAvailability",
      "retry",
    ]) &&
    stage.state === "staged" &&
    stage.operation === "npm_stage_publish" &&
    digestPattern.test(stage.attemptDigest ?? "") &&
    digestPattern.test(stage.authorizationDigest ?? "") &&
    timestamp(stage.completedAt) >= timestamp(stage.reservedAt) &&
    stage.receiptEvidence === "npm_cli_exit_zero" &&
    stage.review === "required_with_2fa" &&
    stage.publicAvailability === "not_claimed" &&
    stage.retry === "forbidden" &&
    validStageTarget &&
    validStageArtifact;
  const validChecks =
    Array.isArray(report?.checks) &&
    report.checks.length === checkIds.length &&
    report.checks.every(
      (check, index) =>
        exactKeys(check, ["id", "status"]) &&
        check.id === checkIds[index] &&
        check.status === "ready",
    );
  const limitations = {
    upstreamEvidenceAuthenticity: "not_verified",
    artifactAfterObservation: "not_verified",
    authorizationAuthenticity: "not_verified",
    npmStageSubmissionProof: "npm_cli_exit_zero_only",
    npmTwoFactorApproval: "not_observed",
    publicAvailability: "not_observed",
  };
  const sideEffects = {
    files: "not_changed",
    githubSettings: "not_changed",
    artifactDownload: "performed_read_only",
    workflowDispatch: "not_attempted",
    workflowRerun: "not_attempted",
    publication: "not_attempted",
  };
  if (
    !exactKeys(report, [
      "schemaVersion",
      "status",
      "evidenceType",
      "target",
      "upstream",
      "github",
      "stage",
      "checks",
      "stageResult",
      "limitations",
      "sideEffects",
      "evidenceDigest",
    ]) ||
    report.schemaVersion !== 1 ||
    report.status !== "evidence_bound" ||
    report.evidenceType !== "first_publication_npm_stage_result" ||
    report.stageResult !== "npm_cli_reported_stage_submission_accepted" ||
    !validTarget ||
    !validUpstream ||
    !validGitHub ||
    !validStage ||
    !validChecks ||
    !exactKeys(report.limitations, Object.keys(limitations)) ||
    canonicalJson(report.limitations) !== canonicalJson(limitations) ||
    !exactKeys(report.sideEffects, Object.keys(sideEffects)) ||
    canonicalJson(report.sideEffects) !== canonicalJson(sideEffects) ||
    !digestPattern.test(report.evidenceDigest ?? "") ||
    timestamp(github.observedAt) < timestamp(upstream.workflowExecutionObservedAt)
  )
    fail();
  const { evidenceDigest, ...body } = report;
  if (evidenceDigest !== canonicalDigest(body)) fail();
  return report;
}

export function validateStageResultUpstreamReport(report) {
  return validateFirstPublicationWorkflowExecutionReportDocument(report);
}
