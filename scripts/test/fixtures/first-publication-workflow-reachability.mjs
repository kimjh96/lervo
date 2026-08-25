import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createCliFirstPublicationWorkflowRemoteDeploymentEvidence } from "../../lib/cli-first-publication-workflow-remote-deployment.mjs";
import {
  createWorkflowRemoteDeploymentFixture,
  matchingRemoteWorkflowObservation,
  workflowRemoteSourceCommit,
} from "./first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from "./first-publication-workflow-activation.mjs";
import { sha256 } from "../../lib/release-artifact-manifest.mjs";
import { remoteCliPackagePath } from "../../lib/first-publication-workflow-reachability-contract.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const currentCliPackage = JSON.parse(
  readFileSync(resolve(repositoryRoot, "apps/cli/package.json"), "utf8"),
);

export const workflowReleaseTag = `v${currentCliPackage.version}`;

export async function createWorkflowReachabilityFixture() {
  const fixture = await createWorkflowRemoteDeploymentFixture();
  const remoteEvidenceReport = await createCliFirstPublicationWorkflowRemoteDeploymentEvidence(
    {
      repository: workflowActivationRepository,
      sourceCommit: workflowRemoteSourceCommit,
      postApplyReportPath: fixture.postApplyReportPath,
      online: true,
    },
    {
      paths: { workflowPath: fixture.paths.workflowPath },
      transactionRoot: fixture.transactionRoot,
      observeRemote: async () => matchingRemoteWorkflowObservation(fixture),
      clock: () => "2026-08-21T10:07:00Z",
    },
  );
  const remoteEvidenceReportPath = resolve(fixture.root, "workflow-remote-evidence.json");
  await writeFile(remoteEvidenceReportPath, `${JSON.stringify(remoteEvidenceReport, null, 2)}\n`);
  const cliPackageContents = await readFile(fixture.paths.cliPackageManifestPath);
  return {
    ...fixture,
    remoteEvidenceReport,
    remoteEvidenceReportPath,
    cliPackageContents,
  };
}

export function matchingWorkflowReachabilityObservation(fixture, overrides = {}) {
  return {
    schemaVersion: 1,
    source: "github_repository_reachability",
    state: "observed",
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    defaultBranch: {
      name: "main",
      headCommit: "e".repeat(40),
      relation: "source_commit_ancestor_or_equal",
      commitsAhead: 2,
    },
    releaseTag: {
      name: workflowReleaseTag,
      kind: "annotated",
      annotatedDepth: 1,
      commit: workflowRemoteSourceCommit,
    },
    sourcePackage: {
      path: remoteCliPackagePath,
      blobSha: "f".repeat(40),
      byteCount: fixture.cliPackageContents.length,
      sha256: sha256(fixture.cliPackageContents),
      contents: fixture.cliPackageContents,
    },
    referenceStability: "rechecked_unchanged",
    ...overrides,
  };
}
