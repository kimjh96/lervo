import { readBoundedStageResultArchive } from
  "./bounded-stage-result-archive.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  createFirstPublicationStageResultReport,
  validateFirstPublicationStageResultReportDocument,
  validateStageResultUpstreamReport,
} from "./first-publication-stage-result-report.mjs";
import { validateReleaseStageResultRecords } from
  "./release-stage-publication-records.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
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
    target.repository !== repository || target.sourceCommit !== sourceCommit ||
    target.releaseTag !== releaseTag || target.runId !== runId ||
    target.attempt !== attempt
  ) {
    fail(
      "first_publication_stage_result_source_mismatch",
      "Workflow 실행 증거와 npm stage 결과 좌표가 일치하지 않습니다.",
    );
  }
  return workflowExecutionReport;
}

function validateObservation(observation, input) {
  if (observation?.state !== "observed") {
    fail(
      "first_publication_stage_result_not_ready",
      "Exact stage 결과 artifact를 읽고 검증하지 못했습니다.",
    );
  }
  if (
    !exactKeys(observation, [
      "schemaVersion", "source", "state", "repository", "sourceCommit", "runId",
      "artifact", "archive", "metadataStability",
    ]) || observation.schemaVersion !== 1 ||
    observation.source !== "github_stage_result_artifact" ||
    observation.repository !== input.repository ||
    observation.sourceCommit !== input.sourceCommit || observation.runId !== input.runId ||
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
      "GitHub stage 결과 artifact 관측이 올바르지 않습니다.",
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
      "Artifact 내부 stage 결과 문서가 올바르지 않습니다.",
    );
  }
  if (
    stageResultRecords.attempt.target.package !== input.workflowExecutionReport.target.package ||
    stageResultRecords.attempt.target.version !== input.workflowExecutionReport.target.version
  ) {
    fail(
      "first_publication_stage_result_source_mismatch",
      "Artifact의 package·version이 workflow 실행 증거와 일치하지 않습니다.",
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
      "CLI npm stage 결과 증거 보고서가 올바르지 않습니다.",
    );
  }
  return report;
}
