import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyCliFirstPublicationWorkflowActivationPostApply } from "../../workflow/cli-first-publication-workflow-activation-post-apply.mjs";
import { remoteReleaseWorkflowPath } from "../../workflow/first-publication-workflow-remote-source-contract.mjs";
import { sha256 } from "../../../../shared/release-artifact-manifest.mjs";
import {
  createAppliedWorkflowActivationFixture,
  readyWorkflowActivationGitHubObservation,
  readyWorkflowActivationNpmObservation,
  workflowActivationRepository,
} from "./first-publication-workflow-activation.mjs";

export const workflowRemoteSourceCommit = "c".repeat(40);

export async function createWorkflowRemoteDeploymentFixture() {
  const fixture = await createAppliedWorkflowActivationFixture();
  const postApplyReport = await verifyCliFirstPublicationWorkflowActivationPostApply(
    {
      repository: workflowActivationRepository,
      receiptPath: fixture.receiptPath,
      online: true,
    },
    {
      paths: fixture.paths,
      transactionRoot: fixture.transactionRoot,
      observeNpm: async () => readyWorkflowActivationNpmObservation(),
      observeGitHub: async () => readyWorkflowActivationGitHubObservation(),
      clock: () => "2026-08-21T10:06:00Z",
    },
  );
  const postApplyReportPath = resolve(fixture.root, "workflow-post-apply-report.json");
  await writeFile(postApplyReportPath, `${JSON.stringify(postApplyReport, null, 2)}\n`);
  return { ...fixture, postApplyReport, postApplyReportPath };
}

export async function matchingRemoteWorkflowObservation(fixture, overrides = {}) {
  const contents = overrides.contents ?? (await readFile(fixture.paths.workflowPath));
  return {
    schemaVersion: 1,
    source: "github_repository_workflow",
    state: "observed",
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    path: remoteReleaseWorkflowPath,
    blobSha: "d".repeat(40),
    byteCount: contents.length,
    sha256: sha256(contents),
    contents,
    ...overrides,
  };
}
