import { isAbsolute, resolve } from "node:path";

import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import {
  createBoundedReleaseSourceSnapshot,
  parseCanonicalReleaseJson,
} from "../../lib/bounded-release-json-source.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "../../lib/release-attestation-file-set.mjs";
import { repositoryRoot } from "../../../distribution/lib/installed-cli.mjs";
import { maximumRemoteWorkflowBytes } from "./first-publication-workflow-remote-source-contract.mjs";

const maximumReportBytes = 64 * 1024;

export const firstPublicationWorkflowRemoteDeploymentPaths = Object.freeze({
  workflowPath: resolve(repositoryRoot, ".github/workflows/cli-release-matrix.yml"),
});

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_remote_deployment_source_invalid",
    "The CLI stage-only workflow remote-deployment evidence source is invalid.",
  );
}

export async function readFirstPublicationWorkflowRemoteDeploymentSources(
  paths,
  postApplyReportPath,
) {
  if (!isAbsolute(paths?.workflowPath ?? "") || !isAbsolute(postApplyReportPath ?? "")) fail();
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
  const workflowSnapshot = createBoundedReleaseSourceSnapshot(
    paths.workflowPath,
    workflowContents,
    maximumRemoteWorkflowBytes,
  );
  const reportSnapshot = createBoundedReleaseSourceSnapshot(
    postApplyReportPath,
    reportContents,
    maximumReportBytes,
  );
  let postApplyReport;
  try {
    postApplyReport = parseCanonicalReleaseJson(reportContents);
  } catch {
    fail();
  }
  return {
    postApplyReport,
    workflowSnapshot,
    reportSnapshot,
    assertUnchanged: () => assertReleaseFilesUnchanged([workflowSnapshot, reportSnapshot]),
  };
}
