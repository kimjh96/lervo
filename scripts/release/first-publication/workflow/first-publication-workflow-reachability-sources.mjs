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
import { maximumRemoteCliPackageBytes } from "./first-publication-workflow-reachability-contract.mjs";

const maximumReportBytes = 64 * 1024;

export const firstPublicationWorkflowReachabilityPaths = Object.freeze({
  cliPackageManifestPath: resolve(repositoryRoot, "apps/cli/package.json"),
});

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_reachability_source_invalid",
    "The CLI stage-only workflow ref-reachability evidence source is invalid.",
  );
}

export async function readFirstPublicationWorkflowReachabilitySources(
  paths,
  remoteEvidenceReportPath,
) {
  if (
    !isAbsolute(paths?.cliPackageManifestPath ?? "") ||
    !isAbsolute(remoteEvidenceReportPath ?? "")
  )
    fail();
  let packageContents;
  let reportContents;
  try {
    [packageContents, reportContents] = await Promise.all([
      readRegularReleaseFile(paths.cliPackageManifestPath, maximumRemoteCliPackageBytes),
      readRegularReleaseFile(remoteEvidenceReportPath, maximumReportBytes),
    ]);
  } catch {
    fail();
  }
  const packageSnapshot = createBoundedReleaseSourceSnapshot(
    paths.cliPackageManifestPath,
    packageContents,
    maximumRemoteCliPackageBytes,
  );
  const reportSnapshot = createBoundedReleaseSourceSnapshot(
    remoteEvidenceReportPath,
    reportContents,
    maximumReportBytes,
  );
  let cliPackage;
  let remoteEvidenceReport;
  try {
    cliPackage = parseCanonicalReleaseJson(packageContents);
    remoteEvidenceReport = parseCanonicalReleaseJson(reportContents);
  } catch {
    fail();
  }
  return {
    cliPackage,
    remoteEvidenceReport,
    packageSnapshot,
    reportSnapshot,
    assertUnchanged: () => assertReleaseFilesUnchanged([packageSnapshot, reportSnapshot]),
  };
}
