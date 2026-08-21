import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  createFirstPublicationStageApprovalAuthorization,
  validateFirstPublicationStageApprovalAuthorization,
} from "./first-publication-stage-approval-authorization.mjs";
import { validateFirstPublicationStageApprovalDecision } from
  "./first-publication-stage-approval-decision.mjs";
import { readFirstPublicationStageApprovalAuthorizationSources } from
  "./first-publication-stage-approval-sources.mjs";
import { validateFirstPublicationStageReviewReportDocument } from
  "./first-publication-stage-review-report.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

function assertCoordinates(report, input) {
  const target = report.target;
  if (
    target.repository !== input.repository || target.sourceCommit !== input.sourceCommit ||
    target.releaseTag !== input.releaseTag || target.runId !== input.runId ||
    target.attempt !== input.attempt
  ) fail(
    "first_publication_stage_approval_source_mismatch",
    "npm stage 승인 좌표와 staged package 검토 증거가 일치하지 않습니다.",
  );
}

export async function authorizeCliFirstPublicationStageApproval(input, dependencies = {}) {
  if (input.write !== true || !isAbsolute(input.outputPath ?? "")) fail(
    "first_publication_stage_approval_write_required",
    "CLI npm stage 승인 권한은 새 output에만 기록할 수 있습니다.",
  );
  const readSources = dependencies.readSources ??
    readFirstPublicationStageApprovalAuthorizationSources;
  const sources = await readSources(input.stageReviewReportPath, input.decisionPath);
  validateFirstPublicationStageReviewReportDocument(sources.stageReviewReport);
  assertCoordinates(sources.stageReviewReport, input);
  const authorizedAt = (dependencies.clock ?? (() => new Date().toISOString()))();
  validateFirstPublicationStageApprovalDecision(sources.decision, {
    checkedAt: authorizedAt,
  });
  const authorizationInput = {
    stageReviewReport: sources.stageReviewReport,
    decision: sources.decision,
    authorizedAt,
  };
  const authorization = createFirstPublicationStageApprovalAuthorization(authorizationInput);
  validateFirstPublicationStageApprovalAuthorization(
    authorization,
    authorizationInput,
    { checkedAt: authorizedAt },
  );
  await sources.assertUnchanged();
  try {
    await writeFile(input.outputPath, `${JSON.stringify(authorization, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === "EEXIST") fail(
      "first_publication_stage_approval_output_exists",
      "CLI npm stage 승인 권한 출력이 이미 있습니다.",
    );
    throw error;
  }
  return authorization;
}
