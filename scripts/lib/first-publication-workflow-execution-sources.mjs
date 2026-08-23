import { isAbsolute } from "node:path";

import {
  createBoundedReleaseSourceSnapshot,
  parseCanonicalReleaseJson,
} from "./bounded-release-json-source.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";

const maximumReachabilityReportBytes = 64 * 1024;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_execution_source_invalid",
    "The CLI stage-only workflow execution evidence source is invalid.",
  );
}

export async function readFirstPublicationWorkflowExecutionSources(
  reachabilityReportPath,
) {
  if (!isAbsolute(reachabilityReportPath ?? "")) fail();
  let contents;
  try {
    contents = await readRegularReleaseFile(
      reachabilityReportPath,
      maximumReachabilityReportBytes,
    );
  } catch {
    fail();
  }
  const snapshot = createBoundedReleaseSourceSnapshot(
    reachabilityReportPath,
    contents,
    maximumReachabilityReportBytes,
  );
  let reachabilityReport;
  try {
    reachabilityReport = parseCanonicalReleaseJson(contents);
  } catch {
    fail();
  }
  return {
    reachabilityReport,
    snapshot,
    assertUnchanged: () => assertReleaseFilesUnchanged([snapshot]),
  };
}
