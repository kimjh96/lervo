import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  createFirstPublicationWorkflowExecutionReport,
  validateFirstPublicationWorkflowExecutionReportDocument,
  validateWorkflowExecutionUpstreamReport,
} from "./first-publication-workflow-execution-report.mjs";
import {
  workflowExecutionArtifactName,
  workflowExecutionJobName,
  workflowResultUploadStepName,
  workflowStageStepName,
} from "./first-publication-workflow-execution-contract.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

export function assertFirstPublicationWorkflowExecutionBinding({
  repository,
  sourceCommit,
  releaseTag,
  runId,
  attempt,
  reachabilityReport,
}) {
  validateWorkflowExecutionUpstreamReport(reachabilityReport);
  if (
    reachabilityReport.target.repository !== repository ||
    reachabilityReport.target.sourceCommit !== sourceCommit ||
    reachabilityReport.target.releaseTag !== releaseTag ||
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    !Number.isSafeInteger(attempt) ||
    attempt <= 0
  ) {
    fail(
      "first_publication_workflow_execution_source_mismatch",
      "The ref-reachability evidence and workflow execution coordinates do not match.",
    );
  }
  return reachabilityReport;
}

function validateObservation(observation, input) {
  if (observation?.state !== "observed") {
    fail(
      "first_publication_workflow_execution_not_ready",
      "The exact GitHub Actions run and stage-job execution could not be verified.",
    );
  }
  const run = observation.run;
  const job = observation.job;
  const artifact = observation.artifact;
  if (
    !exactKeys(observation, [
      "schemaVersion",
      "source",
      "state",
      "repository",
      "sourceCommit",
      "releaseTag",
      "workflow",
      "run",
      "job",
      "artifact",
      "runStability",
    ]) ||
    observation.schemaVersion !== 1 ||
    observation.source !== "github_actions_workflow_execution" ||
    observation.repository !== input.repository ||
    observation.sourceCommit !== input.sourceCommit ||
    observation.releaseTag !== input.releaseTag ||
    !exactKeys(observation.workflow, ["id", "path", "state"]) ||
    !exactKeys(run, [
      "id",
      "attempt",
      "runNumber",
      "workflowId",
      "workflowPath",
      "event",
      "status",
      "conclusion",
      "headBranch",
      "headSha",
      "createdAt",
      "startedAt",
      "updatedAt",
    ]) ||
    !exactKeys(job, [
      "id",
      "runId",
      "name",
      "headSha",
      "status",
      "conclusion",
      "startedAt",
      "completedAt",
      "stage",
      "resultUpload",
    ]) ||
    !exactKeys(artifact, [
      "id",
      "name",
      "sizeInBytes",
      "digest",
      "expired",
      "createdAt",
      "expiresAt",
    ]) ||
    run.id !== input.runId ||
    run.attempt !== input.attempt ||
    run.workflowId !== observation.workflow.id ||
    run.headSha !== input.sourceCommit ||
    run.headBranch !== input.releaseTag ||
    run.event !== "workflow_dispatch" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    job.runId !== input.runId ||
    job.headSha !== input.sourceCommit ||
    job.name !== workflowExecutionJobName ||
    job.status !== "completed" ||
    job.conclusion !== "success" ||
    job.stage?.name !== workflowStageStepName ||
    job.stage.status !== "completed" ||
    job.stage.conclusion !== "success" ||
    job.resultUpload?.name !== workflowResultUploadStepName ||
    job.resultUpload.status !== "completed" ||
    job.resultUpload.conclusion !== "success" ||
    artifact.name !== workflowExecutionArtifactName(input.releaseTag, input.attempt) ||
    artifact.expired !== false ||
    observation.workflow.state !== "active" ||
    observation.runStability !== "rechecked_unchanged"
  ) {
    fail(
      "first_publication_workflow_execution_observation_invalid",
      "The GitHub Actions workflow execution observation is invalid.",
    );
  }
  return observation;
}

export function createFirstPublicationWorkflowExecutionEvidence(input) {
  assertFirstPublicationWorkflowExecutionBinding(input);
  const report = createFirstPublicationWorkflowExecutionReport({
    ...input,
    workflowExecutionObservation: validateObservation(input.workflowExecutionObservation, input),
  });
  return validateFirstPublicationWorkflowExecutionReportDocument(report);
}

export function validateFirstPublicationWorkflowExecutionEvidence(report, input) {
  validateFirstPublicationWorkflowExecutionReportDocument(report);
  const expected = createFirstPublicationWorkflowExecutionEvidence(input);
  if (canonicalJson(report) !== canonicalJson(expected)) {
    fail(
      "first_publication_workflow_execution_report_invalid",
      "The CLI stage-only workflow execution evidence report is invalid.",
    );
  }
  return report;
}
