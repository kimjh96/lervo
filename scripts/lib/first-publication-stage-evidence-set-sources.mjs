import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationStageApprovalEvidenceSet } from
  "./first-publication-stage-approval-evidence-set.mjs";
import { readFirstPublicationStageApprovalReconciliationSources } from
  "./first-publication-stage-approval-reconciliation-sources.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";

const maximumReconciliationReportBytes = 128 * 1024;

function fail(code = "first_publication_stage_evidence_set_source_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI 최초 게시 stage 증거 원본 집합이 올바르지 않습니다.",
  );
}

function parseJson(contents) {
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch {
    fail();
  }
}

export async function readFirstPublicationStageEvidenceSetSources(
  options,
  dependencies = {},
) {
  if (!isAbsolute(options?.reconciliationReportPath ?? "")) fail();
  let reportContents;
  try {
    reportContents = await readRegularReleaseFile(
      options.reconciliationReportPath,
      maximumReconciliationReportBytes,
    );
  } catch {
    fail();
  }
  const readStageSources = dependencies.readStageSources ??
    readFirstPublicationStageApprovalReconciliationSources;
  const stageSources = await readStageSources({
    stageReviewReportPath: options.stageReviewReportPath,
    decisionPath: options.decisionPath,
    authorizationPath: options.authorizationPath,
    resultDirectory: options.resultDirectory,
  }, dependencies);
  const evidenceSet = {
    reconciliationReport: parseJson(reportContents),
    stageReviewReport: stageSources.stageReviewReport,
    decision: stageSources.decision,
    authorization: stageSources.authorization,
    attempt: stageSources.attempt,
    terminal: stageSources.terminal,
  };
  validateFirstPublicationStageApprovalEvidenceSet(evidenceSet);
  return {
    ...evidenceSet,
    assertUnchanged: async () => {
      await Promise.all([
        stageSources.assertUnchanged(),
        assertReleaseFilesUnchanged([{
          path: options.reconciliationReportPath,
          contents: reportContents,
          maximumSize: maximumReconciliationReportBytes,
        }]),
      ]);
    },
  };
}
