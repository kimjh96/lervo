import { isAbsolute } from "node:path";

import {
  createBoundedReleaseSourceSnapshot,
  parseCanonicalReleaseJson,
} from "../../lib/bounded-release-json-source.mjs";
import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import { validateFirstPublicationStageResultReportDocument } from "./first-publication-stage-result-report.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "../../lib/release-attestation-file-set.mjs";

const maximumReportBytes = 128 * 1024;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_stage_review_source_invalid",
    "The CLI npm staged-package review evidence source is invalid.",
  );
}

export async function readFirstPublicationStageReviewSources(stageResultReportPath) {
  if (!isAbsolute(stageResultReportPath ?? "")) fail();
  let contents;
  try {
    contents = await readRegularReleaseFile(stageResultReportPath, maximumReportBytes);
  } catch {
    fail();
  }
  const snapshot = createBoundedReleaseSourceSnapshot(
    stageResultReportPath,
    contents,
    maximumReportBytes,
  );
  let stageResultReport;
  try {
    stageResultReport = validateFirstPublicationStageResultReportDocument(
      parseCanonicalReleaseJson(contents),
    );
  } catch {
    fail();
  }
  return {
    stageResultReport,
    assertUnchanged: () => assertReleaseFilesUnchanged([snapshot]),
  };
}
