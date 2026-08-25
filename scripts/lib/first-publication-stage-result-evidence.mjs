import { readBoundedStageResultArchive } from "./bounded-stage-result-archive.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  createFirstPublicationStageResultReport,
  validateFirstPublicationStageResultReportDocument,
  validateStageResultUpstreamReport,
} from "./first-publication-stage-result-report.mjs";
import { validateReleaseStageResultRecords } from "./release-stage-publication-records.mjs";
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

export function assertFirstPublicationStageResultBinding({
  repository,
  sourceCommit,
  releaseTag,
  runId,
  attempt,
  workflowExecutionReport,
}) {
  validateStageResultUpstreamReport(workflowExecutionReport);
  const target = workflowExecutionReport.target;
  if (
    target.repository !== repository ||
    target.sourceCommit !== sourceCommit ||
    target.releaseTag !== releaseTag ||
    target.runId !== runId ||
    target.attempt !== attempt
  ) {
    fail(
      "first_publication_stage_result_source_mismatch",
      "The workflow execution evidence and npm stage result coordinates do not match.",
    );
  }
  return workflowExecutionReport;
}

function validateObservation(observation, input) {
  if (observation?.state !== "observed") {
    fail(
      "first_publication_stage_result_not_ready",
      "The exact stage-result artifact could not be read and verified.",
    );
  }
  if (
    !exactKeys(observation, [
      "schemaVersion",
      "source",
      "state",
      "repository",
      "sourceCommit",
      "runId",
      "artifact",
      "archive",
      "metadataStability",
    ]) ||
    observation.schemaVersion !== 1 ||
    observation.source !== "github_stage_result_artifact" ||
    observation.repository !== input.repository ||
    observation.sourceCommit !== input.sourceCommit ||
    observation.runId !== input.runId ||
    canonicalJson(observation.artifact) !==
      canonicalJson(input.workflowExecutionReport.github.artifact) ||
    !exactKeys(observation.archive, ["byteCount", "sha256", "contents"]) ||
    !Buffer.isBuffer(observation.archive.contents) ||
    observation.archive.byteCount !== observation.archive.contents.length ||
    observation.archive.sha256 !== observation.artifact.digest ||
    observation.metadataStability !== "rechecked_unchanged"
  ) {
    fail(
      "first_publication_stage_result_observation_invalid",
      "The GitHub stage-result artifact observation is invalid.",
    );
  }
  return observation;
}

export function createFirstPublicationStageResultEvidence(input) {
  assertFirstPublicationStageResultBinding(input);
  const observation = validateObservation(input.stageResultObservation, input);
  let archive;
  let stageResultRecords;
  try {
    archive = readBoundedStageResultArchive(
      observation.archive.contents,
      observation.artifact.digest,
    );
    stageResultRecords = validateReleaseStageResultRecords(archive);
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail(
      "first_publication_stage_result_record_invalid",
      "The stage-result document inside the artifact is invalid.",
    );
  }
  if (
    stageResultRecords.attempt.target.package !== input.workflowExecutionReport.target.package ||
    stageResultRecords.attempt.target.version !== input.workflowExecutionReport.target.version
  ) {
    fail(
      "first_publication_stage_result_source_mismatch",
      "The artifact package and version do not match the workflow execution evidence.",
    );
  }
  const report = createFirstPublicationStageResultReport({
    workflowExecutionReport: input.workflowExecutionReport,
    stageResultObservation: observation,
    stageResultRecords,
    observedAt: input.observedAt,
  });
  return validateFirstPublicationStageResultReportDocument(report);
}

export function validateFirstPublicationStageResultEvidence(report, input) {
  validateFirstPublicationStageResultReportDocument(report);
  const expected = createFirstPublicationStageResultEvidence(input);
  if (canonicalJson(report) !== canonicalJson(expected)) {
    fail(
      "first_publication_stage_result_report_invalid",
      "The CLI npm stage-result evidence report is invalid.",
    );
  }
  return report;
}
