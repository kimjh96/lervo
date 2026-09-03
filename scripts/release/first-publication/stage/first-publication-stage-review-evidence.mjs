import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import {
  createFirstPublicationStageReviewReport,
  validateFirstPublicationStageReviewReportDocument,
  validateStageReviewUpstreamReport,
} from "./first-publication-stage-review-report.mjs";
import { canonicalJson } from "../../../shared/release-artifact-manifest.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export function assertFirstPublicationStageReviewBinding(input) {
  validateStageReviewUpstreamReport(input.stageResultReport);
  const target = input.stageResultReport.target;
  if (
    target.repository !== input.repository ||
    target.sourceCommit !== input.sourceCommit ||
    target.releaseTag !== input.releaseTag ||
    target.runId !== input.runId ||
    target.attempt !== input.attempt
  )
    fail(
      "first_publication_stage_review_source_mismatch",
      "The npm staged-package review coordinates do not match the stage-result evidence.",
    );
  return input.stageResultReport;
}

function validateObservation(observation, stageResultReport) {
  if (observation?.state !== "observed")
    fail(
      "first_publication_stage_review_not_ready",
      "The exact npm staged package and tarball could not be verified.",
    );
  const expected = stageResultReport.stage;
  const exactKeys = (value, keys) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
  if (
    !exactKeys(observation, [
      "schemaVersion",
      "source",
      "state",
      "registry",
      "package",
      "version",
      "stage",
      "tarball",
      "metadataStability",
      "userConfig",
      "temporaryFiles",
    ]) ||
    !exactKeys(observation.stage, ["idDigest", "createdAt", "distTag", "shasum"]) ||
    !exactKeys(observation.tarball, [
      "byteCount",
      "sha256",
      "registryIntegrity",
      "registryShasum",
    ]) ||
    observation.schemaVersion !== 1 ||
    observation.source !== "npm_staged_package_review" ||
    observation.registry !== expected.target.registry ||
    observation.package !== expected.target.package ||
    observation.version !== expected.target.version ||
    observation.stage?.distTag !== expected.target.distTag ||
    !Number.isSafeInteger(observation.tarball?.byteCount) ||
    observation.tarball.byteCount <= 0 ||
    observation.tarball.byteCount > 64 * 1024 * 1024 ||
    observation.metadataStability !== "rechecked_unchanged" ||
    observation.userConfig !== "rechecked_unchanged" ||
    observation.temporaryFiles !== "removed" ||
    canonicalJson(
      observation.tarball && {
        file: expected.artifact.file,
        sha256: observation.tarball.sha256,
        registryIntegrity: observation.tarball.registryIntegrity,
        registryShasum: observation.tarball.registryShasum,
      },
    ) !== canonicalJson(expected.artifact)
  )
    fail(
      "first_publication_stage_review_observation_invalid",
      "The npm staged-package review observation is invalid.",
    );
  return observation;
}

export function createFirstPublicationStageReviewEvidence(input) {
  assertFirstPublicationStageReviewBinding(input);
  const observation = validateObservation(input.observation, input.stageResultReport);
  return validateFirstPublicationStageReviewReportDocument(
    createFirstPublicationStageReviewReport({
      stageResultReport: input.stageResultReport,
      observation,
      observedAt: input.observedAt,
    }),
  );
}

export function validateFirstPublicationStageReviewEvidence(report, input) {
  validateFirstPublicationStageReviewReportDocument(report);
  const expected = createFirstPublicationStageReviewEvidence(input);
  if (canonicalJson(report) !== canonicalJson(expected))
    fail(
      "first_publication_stage_review_report_invalid",
      "The CLI npm staged-package review evidence report is invalid.",
    );
  return report;
}
