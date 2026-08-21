import { resolve } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertFirstPublicationStageReviewBinding,
  createFirstPublicationStageReviewEvidence,
  validateFirstPublicationStageReviewEvidence,
} from "./first-publication-stage-review-evidence.mjs";
import { readFirstPublicationStageReviewSources } from
  "./first-publication-stage-review-sources.mjs";
import { validateWorkflowExecutionCoordinate } from
  "./first-publication-workflow-execution-contract.mjs";
import {
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "./first-publication-workflow-reachability-contract.mjs";
import { repositoryRoot } from "./installed-cli.mjs";
import { observeNpmStagedPackageReview } from
  "./npm-staged-package-review-observer.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export async function createCliFirstPublicationStageReviewEvidence({
  repository,
  sourceCommit,
  releaseTag,
  runId,
  attempt,
  stageResultReportPath,
  npmUserConfigPath,
  online,
}, dependencies = {}) {
  if (online !== true) fail(
    "first_publication_stage_review_online_required",
    "CLI npm staged package 검토 증거에는 온라인 확인이 필요합니다.",
  );
  try {
    validateReadinessRepository(repository);
    validateWorkflowReachabilityCommit(sourceCommit);
    validateWorkflowReachabilityReleaseTag(releaseTag);
    validateWorkflowExecutionCoordinate(runId);
    validateWorkflowExecutionCoordinate(attempt);
  } catch {
    fail(
      "first_publication_stage_review_input_invalid",
      "CLI npm staged package 검토 증거 입력이 올바르지 않습니다.",
    );
  }
  const readSources = dependencies.readSources ?? readFirstPublicationStageReviewSources;
  const sources = await readSources(stageResultReportPath);
  const binding = {
    repository,
    sourceCommit,
    releaseTag,
    runId,
    attempt,
    stageResultReport: sources.stageResultReport,
  };
  assertFirstPublicationStageReviewBinding(binding);
  const observe = dependencies.observe ?? observeNpmStagedPackageReview;
  const observation = await observe({
    registry: sources.stageResultReport.stage.target.registry,
    packageName: sources.stageResultReport.stage.target.package,
    version: sources.stageResultReport.stage.target.version,
    expectedArtifact: sources.stageResultReport.stage.artifact,
    userConfigPath: npmUserConfigPath,
  }, {
    npmCommand: dependencies.npmCommand ?? resolve(
      repositoryRoot,
      process.platform === "win32" ? "node_modules/.bin/npm.cmd" : "node_modules/.bin/npm",
    ),
    ...(dependencies.observerDependencies ?? {}),
  });
  const observedAt = (dependencies.clock ?? (() => new Date().toISOString()))();
  await sources.assertUnchanged();
  const input = { ...binding, observation, observedAt };
  const report = createFirstPublicationStageReviewEvidence(input);
  return validateFirstPublicationStageReviewEvidence(report, input);
}
