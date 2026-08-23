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

const maximumReviewReportBytes = 128 * 1024;
const maximumDecisionBytes = 64 * 1024;
const maximumAuthorizationBytes = 128 * 1024;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_stage_approval_source_invalid",
    "The CLI npm stage approval authorization source is invalid.",
  );
}

async function readSource(path, maximumSize) {
  if (!isAbsolute(path ?? "")) fail();
  let contents;
  try {
    contents = await readRegularReleaseFile(path, maximumSize);
  } catch {
    fail();
  }
  let value;
  try {
    value = parseCanonicalReleaseJson(contents);
  } catch {
    fail();
  }
  return {
    value,
    snapshot: createBoundedReleaseSourceSnapshot(path, contents, maximumSize),
  };
}

async function readSources(stageReviewReportPath, decisionPath, authorizationPath) {
  const [report, decision, authorization] = await Promise.all([
    readSource(stageReviewReportPath, maximumReviewReportBytes),
    readSource(decisionPath, maximumDecisionBytes),
    authorizationPath === undefined
      ? undefined
      : readSource(authorizationPath, maximumAuthorizationBytes),
  ]);
  const snapshots = [report.snapshot, decision.snapshot,
    ...(authorization === undefined ? [] : [authorization.snapshot])];
  return {
    stageReviewReport: report.value,
    decision: decision.value,
    ...(authorization === undefined ? {} : { authorization: authorization.value }),
    assertUnchanged: () => assertReleaseFilesUnchanged(snapshots),
  };
}

export function readFirstPublicationStageApprovalAuthorizationSources(
  stageReviewReportPath,
  decisionPath,
) {
  return readSources(stageReviewReportPath, decisionPath);
}

export function readFirstPublicationStageApprovalExecutionSources(
  stageReviewReportPath,
  decisionPath,
  authorizationPath,
) {
  return readSources(stageReviewReportPath, decisionPath, authorizationPath);
}
