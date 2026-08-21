import { isAbsolute, resolve } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";
import { sha256 } from "./release-artifact-manifest.mjs";
import { repositoryRoot } from "./installed-cli.mjs";
import { maximumRemoteWorkflowBytes } from
  "./first-publication-workflow-remote-source-contract.mjs";

const maximumReportBytes = 64 * 1024;

export const firstPublicationWorkflowRemoteDeploymentPaths = Object.freeze({
  workflowPath: resolve(repositoryRoot, ".github/workflows/cli-release-matrix.yml"),
});

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_remote_deployment_source_invalid",
    "CLI stage-only workflow 원격 배포 증거 원본이 올바르지 않습니다.",
  );
}

function snapshot(path, contents, maximumSize) {
  return {
    path,
    contents,
    maximumSize,
    byteCount: contents.length,
    sha256: sha256(contents),
  };
}

function parseCanonicalReport(contents) {
  let report;
  try {
    report = JSON.parse(contents.toString("utf8"));
  } catch {
    fail();
  }
  if (
    report === null || typeof report !== "object" || Array.isArray(report) ||
    !contents.equals(Buffer.from(`${JSON.stringify(report, null, 2)}\n`))
  ) fail();
  return report;
}

export async function readFirstPublicationWorkflowRemoteDeploymentSources(
  paths,
  postApplyReportPath,
) {
  if (
    !isAbsolute(paths?.workflowPath ?? "") ||
    !isAbsolute(postApplyReportPath ?? "")
  ) fail();
  let workflowContents;
  let reportContents;
  try {
    [workflowContents, reportContents] = await Promise.all([
      readRegularReleaseFile(paths.workflowPath, maximumRemoteWorkflowBytes),
      readRegularReleaseFile(postApplyReportPath, maximumReportBytes),
    ]);
  } catch {
    fail();
  }
  const workflowSnapshot = snapshot(
    paths.workflowPath,
    workflowContents,
    maximumRemoteWorkflowBytes,
  );
  const reportSnapshot = snapshot(
    postApplyReportPath,
    reportContents,
    maximumReportBytes,
  );
  return {
    postApplyReport: parseCanonicalReport(reportContents),
    workflowSnapshot,
    reportSnapshot,
    assertUnchanged: () => assertReleaseFilesUnchanged([
      workflowSnapshot,
      reportSnapshot,
    ]),
  };
}
