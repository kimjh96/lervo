import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  maximumWorkflowExecutionArtifactBytes,
  workflowExecutionJobName,
  workflowResultUploadStepName,
  workflowStageStepName,
} from "./first-publication-workflow-execution-contract.mjs";
import { validateCliReleaseTag } from "./cli-release-attestation.mjs";
import {
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "./first-publication-workflow-reachability-contract.mjs";
import { validateFirstPublicationWorkflowReachabilityReportDocument } from
  "./first-publication-workflow-reachability-report.mjs";
import { remoteReleaseWorkflowPath } from
  "./first-publication-workflow-remote-source-contract.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const checkIds = Object.freeze([
  "ref_reachability_evidence",
  "exact_workflow_identity",
  "exact_latest_run_attempt",
  "exact_source_and_release_tag",
  "workflow_run_terminal_success",
  "stage_job_terminal_success",
  "stage_and_result_upload_steps_terminal_success",
  "stage_result_artifact_metadata",
]);

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_execution_report_invalid",
    "The CLI stage-only workflow execution evidence report is invalid.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail();
  return parsed;
}

function positive(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validStep(step, name) {
  return exactKeys(step, [
    "name", "number", "status", "conclusion", "startedAt", "completedAt",
  ]) && step.name === name && positive(step.number) && step.status === "completed" &&
    step.conclusion === "success" && timestamp(step.completedAt) >= timestamp(step.startedAt);
}

export function createFirstPublicationWorkflowExecutionReport({
  reachabilityReport,
  workflowExecutionObservation,
  observedAt,
}) {
  const observation = workflowExecutionObservation;
  const body = {
    schemaVersion: 1,
    status: "evidence_bound",
    evidenceType: "first_publication_stage_only_workflow_execution",
    target: {
      ...reachabilityReport.target,
      runId: observation.run.id,
      attempt: observation.run.attempt,
    },
    upstream: {
      reachabilityEvidenceDigest: reachabilityReport.evidenceDigest,
      reachabilityObservedAt: reachabilityReport.github.observedAt,
      remoteDeploymentEvidenceDigest:
        reachabilityReport.upstream.remoteDeploymentEvidenceDigest,
      workflowSha256: reachabilityReport.upstream.workflowSha256,
    },
    github: {
      observedAt,
      workflow: observation.workflow,
      run: observation.run,
      job: observation.job,
      artifact: observation.artifact,
      runStability: observation.runStability,
    },
    checks: checkIds.map((id) => ({ id, status: "ready" })),
    execution: "exact_attempt_completed_success_with_stage_result_artifact",
    limitations: {
      upstreamEvidenceAuthenticity: "not_verified",
      laterWorkflowRerun: "not_verified",
      artifactContents: "not_verified",
      npmStageSubmission: "not_observed",
      npmTwoFactorApproval: "not_observed",
      publicAvailability: "not_observed",
    },
    sideEffects: {
      files: "not_changed",
      githubSettings: "not_changed",
      workflowDispatch: "not_attempted",
      workflowRerun: "not_attempted",
      artifactDownload: "not_attempted",
      publication: "not_attempted",
    },
  };
  return { ...body, evidenceDigest: canonicalDigest(body) };
}

export function validateFirstPublicationWorkflowExecutionReportDocument(report) {
  const target = report?.target;
  const upstream = report?.upstream;
  const github = report?.github;
  const workflow = github?.workflow;
  const run = github?.run;
  const job = github?.job;
  const artifact = github?.artifact;
  try {
    validateReadinessRepository(target?.repository);
    validateWorkflowReachabilityCommit(target?.sourceCommit);
    validateWorkflowReachabilityReleaseTag(target?.releaseTag);
    validateCliReleaseTag(target?.version, target?.releaseTag);
  } catch {
    fail();
  }
  const validTarget = exactKeys(target, [
    "repository", "sourceCommit", "releaseTag", "package", "version",
    "workflowPath", "runId", "attempt",
  ]) && target.package === "@lervo/cli" &&
    target.workflowPath === remoteReleaseWorkflowPath &&
    commitPattern.test(target.sourceCommit ?? "") && positive(target.runId) &&
    positive(target.attempt);
  const validUpstream = exactKeys(upstream, [
    "reachabilityEvidenceDigest", "reachabilityObservedAt",
    "remoteDeploymentEvidenceDigest", "workflowSha256",
  ]) && digestPattern.test(upstream.reachabilityEvidenceDigest ?? "") &&
    digestPattern.test(upstream.remoteDeploymentEvidenceDigest ?? "") &&
    digestPattern.test(upstream.workflowSha256 ?? "");
  const validWorkflow = exactKeys(workflow, ["id", "path", "state"]) &&
    positive(workflow.id) && workflow.path === remoteReleaseWorkflowPath &&
    workflow.state === "active";
  const validRun = exactKeys(run, [
    "id", "attempt", "runNumber", "workflowId", "workflowPath", "event",
    "status", "conclusion", "headBranch", "headSha", "createdAt", "startedAt",
    "updatedAt",
  ]) && run.id === target?.runId && run.attempt === target?.attempt &&
    positive(run.runNumber) && run.workflowId === workflow?.id &&
    run.workflowPath === remoteReleaseWorkflowPath && run.event === "workflow_dispatch" &&
    run.status === "completed" && run.conclusion === "success" &&
    run.headBranch === target?.releaseTag && run.headSha === target?.sourceCommit &&
    timestamp(run.startedAt) >= timestamp(run.createdAt) &&
    timestamp(run.updatedAt) >= timestamp(run.startedAt);
  const validJob = exactKeys(job, [
    "id", "runId", "name", "headSha", "status", "conclusion", "startedAt",
    "completedAt", "stage", "resultUpload",
  ]) && positive(job.id) && job.runId === target?.runId &&
    job.name === workflowExecutionJobName && job.headSha === target?.sourceCommit &&
    job.status === "completed" && job.conclusion === "success" &&
    timestamp(job.completedAt) >= timestamp(job.startedAt) &&
    validStep(job.stage, workflowStageStepName) &&
    validStep(job.resultUpload, workflowResultUploadStepName);
  const validArtifact = exactKeys(artifact, [
    "id", "name", "sizeInBytes", "digest", "expired", "createdAt", "expiresAt",
  ]) && positive(artifact.id) && positive(artifact.sizeInBytes) &&
    artifact.sizeInBytes <= maximumWorkflowExecutionArtifactBytes &&
    artifact.name === `lervo-cli-stage-${target?.releaseTag}-${target?.attempt}` &&
    digestPattern.test(artifact.digest ?? "") && artifact.expired === false &&
    timestamp(artifact.expiresAt) > timestamp(artifact.createdAt);
  const validGitHub = exactKeys(github, [
    "observedAt", "workflow", "run", "job", "artifact", "runStability",
  ]) && validWorkflow && validRun && validJob && validArtifact &&
    github.runStability === "rechecked_unchanged";
  const validChecks = Array.isArray(report?.checks) &&
    report.checks.length === checkIds.length && report.checks.every((check, index) =>
      exactKeys(check, ["id", "status"]) && check.id === checkIds[index] &&
      check.status === "ready"
    );
  const limitations = {
    upstreamEvidenceAuthenticity: "not_verified",
    laterWorkflowRerun: "not_verified",
    artifactContents: "not_verified",
    npmStageSubmission: "not_observed",
    npmTwoFactorApproval: "not_observed",
    publicAvailability: "not_observed",
  };
  const sideEffects = {
    files: "not_changed",
    githubSettings: "not_changed",
    workflowDispatch: "not_attempted",
    workflowRerun: "not_attempted",
    artifactDownload: "not_attempted",
    publication: "not_attempted",
  };
  if (
    !exactKeys(report, [
      "schemaVersion", "status", "evidenceType", "target", "upstream", "github",
      "checks", "execution", "limitations", "sideEffects", "evidenceDigest",
    ]) || report.schemaVersion !== 1 || report.status !== "evidence_bound" ||
    report.evidenceType !== "first_publication_stage_only_workflow_execution" ||
    report.execution !== "exact_attempt_completed_success_with_stage_result_artifact" ||
    !validTarget || !validUpstream || !validGitHub || !validChecks ||
    !exactKeys(report.limitations, Object.keys(limitations)) ||
    canonicalJson(report.limitations) !== canonicalJson(limitations) ||
    !exactKeys(report.sideEffects, Object.keys(sideEffects)) ||
    canonicalJson(report.sideEffects) !== canonicalJson(sideEffects) ||
    !digestPattern.test(report.evidenceDigest ?? "") ||
    timestamp(github.observedAt) < timestamp(upstream.reachabilityObservedAt)
  ) fail();
  const { evidenceDigest, ...body } = report;
  if (evidenceDigest !== canonicalDigest(body)) fail();
  return report;
}

export function validateWorkflowExecutionUpstreamReport(report) {
  return validateFirstPublicationWorkflowReachabilityReportDocument(report);
}
