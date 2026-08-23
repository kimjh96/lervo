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

const maximumWorkflowExecutionReportBytes = 128 * 1024;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_stage_result_source_invalid",
    "The CLI npm stage-result evidence source is invalid.",
  );
}

export async function readFirstPublicationStageResultSources(
  workflowExecutionReportPath,
) {
  if (!isAbsolute(workflowExecutionReportPath ?? "")) fail();
  let contents;
  try {
    contents = await readRegularReleaseFile(
      workflowExecutionReportPath,
      maximumWorkflowExecutionReportBytes,
    );
  } catch {
    fail();
  }
  const snapshot = createBoundedReleaseSourceSnapshot(
    workflowExecutionReportPath,
    contents,
    maximumWorkflowExecutionReportBytes,
  );
  let workflowExecutionReport;
  try {
    workflowExecutionReport = parseCanonicalReleaseJson(contents);
  } catch {
    fail();
  }
  return {
    workflowExecutionReport,
    snapshot,
    assertUnchanged: () => assertReleaseFilesUnchanged([snapshot]),
  };
}
