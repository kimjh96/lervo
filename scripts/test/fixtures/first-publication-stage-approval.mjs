import {
  createFirstPublicationStageApprovalAuthorization,
} from "../../lib/first-publication-stage-approval-authorization.mjs";
import { createFirstPublicationStageApprovalDecision } from
  "../../lib/first-publication-stage-approval-decision.mjs";
import { createFirstPublicationStageReviewFixture } from
  "./first-publication-stage-review.mjs";

export async function createFirstPublicationStageApprovalFixture() {
  const value = await createFirstPublicationStageReviewFixture();
  const decision = createFirstPublicationStageApprovalDecision({
    decisionId: "nsa_0123456789abcdef01234567",
    stageReviewEvidenceDigest: value.stageReviewReport.evidenceDigest,
    stageIdDigest: value.stageReviewReport.npm.stage.idDigest,
    package: value.stageReviewReport.target.package,
    version: value.stageReviewReport.target.version,
    decidedAt: "2026-08-21T10:16:00Z",
    expiresAt: "2026-08-21T10:26:00Z",
  });
  const authorizationInput = {
    stageReviewReport: value.stageReviewReport,
    decision,
    authorizedAt: "2026-08-21T10:16:30Z",
  };
  const authorization = createFirstPublicationStageApprovalAuthorization(
    authorizationInput,
  );
  return { ...value, decision, authorizationInput, authorization };
}
