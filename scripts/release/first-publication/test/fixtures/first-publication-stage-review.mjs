import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createCliFirstPublicationStageReviewEvidence } from "../../stage/cli-first-publication-stage-review.mjs";
import { createCliFirstPublicationStageResultEvidence } from "../../stage/cli-first-publication-stage-result.mjs";
import { sha256 } from "../../../../shared/release-artifact-manifest.mjs";
import {
  createFirstPublicationStageResultFixture,
  matchingStageResultObservation,
} from "./first-publication-stage-result.mjs";
import {
  workflowExecutionAttempt,
  workflowExecutionRunId,
} from "./first-publication-workflow-execution.mjs";
import { workflowReleaseTag } from "./first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from "./first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from "./first-publication-workflow-activation.mjs";

export const stagedPackageId = "123e4567-e89b-42d3-a456-426614174000";

export function matchingStageReviewObservation(stageResultReport) {
  return {
    schemaVersion: 1,
    source: "npm_staged_package_review",
    state: "observed",
    registry: stageResultReport.stage.target.registry,
    package: stageResultReport.target.package,
    version: stageResultReport.target.version,
    stage: {
      idDigest: sha256(stagedPackageId),
      createdAt: "2026-08-21T10:11:00Z",
      distTag: stageResultReport.stage.target.distTag,
      shasum: stageResultReport.stage.artifact.registryShasum,
    },
    tarball: {
      byteCount: Buffer.byteLength("first-publication-fixture-tarball"),
      sha256: stageResultReport.stage.artifact.sha256,
      registryIntegrity: stageResultReport.stage.artifact.registryIntegrity,
      registryShasum: stageResultReport.stage.artifact.registryShasum,
    },
    metadataStability: "rechecked_unchanged",
    userConfig: "rechecked_unchanged",
    temporaryFiles: "removed",
  };
}

export async function createFirstPublicationStageReviewFixture() {
  const value = await createFirstPublicationStageResultFixture();
  const stageResultReport = await createCliFirstPublicationStageResultEvidence(
    {
      repository: workflowActivationRepository,
      sourceCommit: workflowRemoteSourceCommit,
      releaseTag: workflowReleaseTag,
      runId: workflowExecutionRunId,
      attempt: workflowExecutionAttempt,
      workflowExecutionReportPath: value.workflowExecutionReportPath,
      online: true,
    },
    {
      observeStageResult: async () => matchingStageResultObservation(value),
      clock: () => "2026-08-21T10:14:00Z",
    },
  );
  const stageResultReportPath = resolve(value.root, "stage-result.json");
  const npmUserConfigPath = resolve(value.root, "user.npmrc");
  await writeFile(stageResultReportPath, `${JSON.stringify(stageResultReport, null, 2)}\n`);
  await writeFile(npmUserConfigPath, "//registry.npmjs.org/:_authToken=fixture\n");
  const stageReviewReport = await createCliFirstPublicationStageReviewEvidence(
    {
      repository: workflowActivationRepository,
      sourceCommit: workflowRemoteSourceCommit,
      releaseTag: workflowReleaseTag,
      runId: workflowExecutionRunId,
      attempt: workflowExecutionAttempt,
      stageResultReportPath,
      npmUserConfigPath,
      online: true,
    },
    {
      observe: async () => matchingStageReviewObservation(stageResultReport),
      clock: () => "2026-08-21T10:15:00Z",
    },
  );
  const stageReviewReportPath = resolve(value.root, "stage-review.json");
  await writeFile(stageReviewReportPath, `${JSON.stringify(stageReviewReport, null, 2)}\n`);
  return {
    ...value,
    stageResultReport,
    stageResultReportPath,
    npmUserConfigPath,
    stageReviewReport,
    stageReviewReportPath,
  };
}
