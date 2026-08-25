import { validateFirstPublicationStageApprovalAuthorization } from "./first-publication-stage-approval-authorization.mjs";
import { validateFirstPublicationStageApprovalDecision } from "./first-publication-stage-approval-decision.mjs";
import {
  bindFirstPublicationStageApprovalTerminal,
  validateFirstPublicationStageApprovalAttempt,
} from "./first-publication-stage-approval-records.mjs";
import {
  validateFirstPublicationStageApprovalReconciliationReport,
  validateFirstPublicationStageApprovalReconciliationReportDocument,
} from "./first-publication-stage-approval-reconciliation.mjs";
import { validateFirstPublicationStageReviewReportDocument } from "./first-publication-stage-review-report.mjs";

function observationFromReport(report) {
  return {
    schemaVersion: 1,
    source: "npm_stage_approval_reconciliation",
    state: "observed",
    registry: report.npm.registry,
    package: report.target.package,
    version: report.target.version,
    distTag: report.binding.stage.distTag,
    publicRelease: report.npm.publicRelease,
    stage: report.npm.approvalStage,
    stageListStability: report.npm.stageListStability,
    userConfig: report.npm.userConfig,
    temporaryFiles: report.npm.temporaryFiles,
  };
}

export function validateFirstPublicationStageApprovalEvidenceSet(evidence) {
  const { reconciliationReport, stageReviewReport, decision, authorization, attempt, terminal } =
    evidence ?? {};
  validateFirstPublicationStageReviewReportDocument(stageReviewReport);
  validateFirstPublicationStageApprovalDecision(decision);
  validateFirstPublicationStageApprovalAuthorization(authorization, {
    stageReviewReport,
    decision,
    authorizedAt: authorization?.validity?.authorizedAt,
  });
  validateFirstPublicationStageApprovalAttempt(attempt);
  bindFirstPublicationStageApprovalTerminal(terminal, attempt);
  validateFirstPublicationStageApprovalReconciliationReportDocument(reconciliationReport);
  validateFirstPublicationStageApprovalReconciliationReport(reconciliationReport, {
    stageReviewReport,
    authorization,
    attempt,
    terminal,
    observation: observationFromReport(reconciliationReport),
    observedAt: reconciliationReport.npm.observedAt,
  });
  return evidence;
}
