import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createCliFirstPublicationWorkflowReachabilityEvidence } from "../../workflow/cli-first-publication-workflow-reachability.mjs";
import { remoteReleaseWorkflowPath } from "../../workflow/first-publication-workflow-remote-source-contract.mjs";
import {
  workflowExecutionArtifactName,
  workflowExecutionJobName,
  workflowResultUploadStepName,
  workflowStageStepName,
} from "../../workflow/first-publication-workflow-execution-contract.mjs";
import {
  createWorkflowReachabilityFixture,
  matchingWorkflowReachabilityObservation,
  workflowReleaseTag,
} from "./first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from "./first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from "./first-publication-workflow-activation.mjs";

export const workflowExecutionRunId = 12_345_678;
export const workflowExecutionAttempt = 2;

export async function createWorkflowExecutionFixture() {
  const fixture = await createWorkflowReachabilityFixture();
  const reachabilityReport = await createCliFirstPublicationWorkflowReachabilityEvidence(
    {
      repository: workflowActivationRepository,
      sourceCommit: workflowRemoteSourceCommit,
      releaseTag: workflowReleaseTag,
      remoteEvidenceReportPath: fixture.remoteEvidenceReportPath,
      online: true,
    },
    {
      paths: { cliPackageManifestPath: fixture.paths.cliPackageManifestPath },
      observeReachability: async () => matchingWorkflowReachabilityObservation(fixture),
      clock: () => "2026-08-21T10:08:00Z",
    },
  );
  const reachabilityReportPath = resolve(fixture.root, "workflow-reachability.json");
  await writeFile(reachabilityReportPath, `${JSON.stringify(reachabilityReport, null, 2)}\n`);
  return { ...fixture, reachabilityReport, reachabilityReportPath };
}

export function matchingWorkflowExecutionObservation(overrides = {}) {
  const observation = {
    schemaVersion: 1,
    source: "github_actions_workflow_execution",
    state: "observed",
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    releaseTag: workflowReleaseTag,
    workflow: {
      id: 77,
      path: remoteReleaseWorkflowPath,
      state: "active",
    },
    run: {
      id: workflowExecutionRunId,
      attempt: workflowExecutionAttempt,
      runNumber: 41,
      workflowId: 77,
      workflowPath: remoteReleaseWorkflowPath,
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      headBranch: workflowReleaseTag,
      headSha: workflowRemoteSourceCommit,
      createdAt: "2026-08-21T10:09:00Z",
      startedAt: "2026-08-21T10:09:03Z",
      updatedAt: "2026-08-21T10:12:00Z",
    },
    job: {
      id: 88,
      runId: workflowExecutionRunId,
      name: workflowExecutionJobName,
      headSha: workflowRemoteSourceCommit,
      status: "completed",
      conclusion: "success",
      startedAt: "2026-08-21T10:10:00Z",
      completedAt: "2026-08-21T10:11:50Z",
      stage: {
        name: workflowStageStepName,
        number: 6,
        status: "completed",
        conclusion: "success",
        startedAt: "2026-08-21T10:10:30Z",
        completedAt: "2026-08-21T10:11:15Z",
      },
      resultUpload: {
        name: workflowResultUploadStepName,
        number: 7,
        status: "completed",
        conclusion: "success",
        startedAt: "2026-08-21T10:11:16Z",
        completedAt: "2026-08-21T10:11:45Z",
      },
    },
    artifact: {
      id: 99,
      name: workflowExecutionArtifactName(workflowReleaseTag, workflowExecutionAttempt),
      sizeInBytes: 4_096,
      digest: `sha256:${"a".repeat(64)}`,
      expired: false,
      createdAt: "2026-08-21T10:11:40Z",
      expiresAt: "2026-09-20T10:11:40Z",
    },
    runStability: "rechecked_unchanged",
  };
  return { ...observation, ...overrides };
}
