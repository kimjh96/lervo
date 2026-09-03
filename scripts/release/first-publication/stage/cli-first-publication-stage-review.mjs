import { resolve } from "node:path";

import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import {
  assertFirstPublicationStageReviewBinding,
  createFirstPublicationStageReviewEvidence,
  validateFirstPublicationStageReviewEvidence,
} from "./first-publication-stage-review-evidence.mjs";
import { readFirstPublicationStageReviewSources } from "./first-publication-stage-review-sources.mjs";
import { validateWorkflowExecutionCoordinate } from "../workflow/first-publication-workflow-execution-contract.mjs";
import {
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "../workflow/first-publication-workflow-reachability-contract.mjs";
import { repositoryRoot } from "../../../distribution/lib/installed-cli.mjs";
import { observeNpmStagedPackageReview } from "../adapters/npm-staged-package-review-observer.mjs";
import { validateReadinessRepository } from "../../lib/trusted-publisher-readiness.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export async function createCliFirstPublicationStageReviewEvidence(
  {
    repository,
    sourceCommit,
    releaseTag,
    runId,
    attempt,
    stageResultReportPath,
    npmUserConfigPath,
    online,
  },
  dependencies = {},
) {
  if (online !== true)
    fail(
      "first_publication_stage_review_online_required",
      "CLI npm staged-package review evidence requires online verification.",
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
      "The CLI npm staged-package review evidence input is invalid.",
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
  const observation = await observe(
    {
      registry: sources.stageResultReport.stage.target.registry,
      packageName: sources.stageResultReport.stage.target.package,
      version: sources.stageResultReport.stage.target.version,
      expectedArtifact: sources.stageResultReport.stage.artifact,
      userConfigPath: npmUserConfigPath,
    },
    {
      npmCommand:
        dependencies.npmCommand ??
        resolve(
          repositoryRoot,
          process.platform === "win32" ? "node_modules/.bin/npm.cmd" : "node_modules/.bin/npm",
        ),
      ...(dependencies.observerDependencies ?? {}),
    },
  );
  const observedAt = (dependencies.clock ?? (() => new Date().toISOString()))();
  await sources.assertUnchanged();
  const input = { ...binding, observation, observedAt };
  const report = createFirstPublicationStageReviewEvidence(input);
  return validateFirstPublicationStageReviewEvidence(report, input);
}
