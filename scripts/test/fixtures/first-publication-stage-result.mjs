import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createCliFirstPublicationWorkflowExecutionEvidence } from
  "../../lib/cli-first-publication-workflow-execution.mjs";
import {
  createReleaseStageAttempt,
  createReleaseStageTerminal,
} from "../../lib/release-stage-publication-records.mjs";
import { sha256 } from "../../lib/release-artifact-manifest.mjs";
import { createFirstPublicationFixture } from "./first-publication.mjs";
import {
  createWorkflowExecutionFixture,
  matchingWorkflowExecutionObservation,
  workflowExecutionAttempt,
  workflowExecutionRunId,
} from "./first-publication-workflow-execution.mjs";
import { workflowReleaseTag } from
  "./first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from
  "./first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from
  "./first-publication-workflow-activation.mjs";
import { createZipArchive } from "./zip-archive.mjs";

function acceptedReceipt(authorization) {
  return {
    schemaVersion: 1,
    status: "stage_submission_accepted",
    operation: "npm_stage_publish",
    target: structuredClone(authorization.target),
    artifact: structuredClone(authorization.artifact),
    evidence: "npm_cli_exit_zero",
  };
}

export function createStageResultArchive({
  descriptor = true,
  terminalState = "staged",
  entryNames = ["attempt.json", "terminal.json"],
  version = "0.1.0",
} = {}) {
  const authorization = createFirstPublicationFixture({
    version,
    sourceDigest: workflowRemoteSourceCommit,
  }).publicationAuthorization;
  const attempt = createReleaseStageAttempt({
    authorization,
    reservedAt: "2026-08-21T10:10:35Z",
  });
  const terminal = createReleaseStageTerminal({
    attempt,
    authorization,
    state: terminalState,
    completedAt: "2026-08-21T10:11:00Z",
    ...(terminalState === "staged"
      ? { receipt: acceptedReceipt(authorization) }
      : {}),
  });
  const documents = new Map([
    ["attempt.json", Buffer.from(`${JSON.stringify(attempt, null, 2)}\n`)],
    ["terminal.json", Buffer.from(`${JSON.stringify(terminal, null, 2)}\n`)],
  ]);
  const archiveContents = createZipArchive(
    entryNames.map((name) => [name, documents.get(name) ?? Buffer.from("{}\n")]),
    { descriptor },
  );
  return { authorization, attempt, terminal, archiveContents };
}

export async function createFirstPublicationStageResultFixture(stageOptions = {}) {
  const fixture = await createWorkflowExecutionFixture();
  const stage = createStageResultArchive(stageOptions);
  const artifact = {
    ...matchingWorkflowExecutionObservation().artifact,
    sizeInBytes: stage.archiveContents.length,
    digest: sha256(stage.archiveContents),
  };
  const workflowExecutionReport =
    await createCliFirstPublicationWorkflowExecutionEvidence({
      repository: workflowActivationRepository,
      sourceCommit: workflowRemoteSourceCommit,
      releaseTag: workflowReleaseTag,
      runId: workflowExecutionRunId,
      attempt: workflowExecutionAttempt,
      reachabilityReportPath: fixture.reachabilityReportPath,
      online: true,
    }, {
      observeExecution: async () => matchingWorkflowExecutionObservation({ artifact }),
      clock: () => "2026-08-21T10:13:00Z",
    });
  const workflowExecutionReportPath = resolve(
    fixture.root,
    "workflow-execution.json",
  );
  await writeFile(
    workflowExecutionReportPath,
    `${JSON.stringify(workflowExecutionReport, null, 2)}\n`,
  );
  return {
    ...fixture,
    ...stage,
    artifact,
    workflowExecutionReport,
    workflowExecutionReportPath,
  };
}

export function matchingStageResultObservation(fixture, overrides = {}) {
  return {
    schemaVersion: 1,
    source: "github_stage_result_artifact",
    state: "observed",
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    runId: workflowExecutionRunId,
    artifact: structuredClone(fixture.artifact),
    archive: {
      byteCount: fixture.archiveContents.length,
      sha256: sha256(fixture.archiveContents),
      contents: fixture.archiveContents,
    },
    metadataStability: "rechecked_unchanged",
    ...overrides,
  };
}
