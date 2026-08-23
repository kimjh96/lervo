import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationStageApprovalDecision } from
  "./first-publication-stage-approval-decision.mjs";
import { validateFirstPublicationStageReviewReportDocument } from
  "./first-publication-stage-review-report.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";

const maximumReviewAgeMilliseconds = 10 * 60 * 1000;
const maximumAuthorizationLifetimeMilliseconds = 5 * 60 * 1000;

function fail(code = "first_publication_stage_approval_authorization_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI npm stage approval authorization is invalid.",
  );
}

function milliseconds(value) {
  const result = Date.parse(value ?? "");
  if (!Number.isFinite(result)) fail();
  return result;
}

function authorizationBody({ stageReviewReport, decision, authorizedAt }) {
  validateFirstPublicationStageReviewReportDocument(stageReviewReport);
  if (stageReviewReport.schemaVersion !== 2) {
    fail("first_publication_stage_approval_review_mismatch");
  }
  validateFirstPublicationStageApprovalDecision(decision, { checkedAt: authorizedAt });
  const observedAt = milliseconds(stageReviewReport.npm.observedAt);
  const authorized = milliseconds(authorizedAt);
  const decidedAt = milliseconds(decision.decidedAt);
  if (
    authorized < observedAt || authorized - observedAt > maximumReviewAgeMilliseconds ||
    decidedAt < observedAt ||
    decision.binding.stageReviewEvidenceDigest !== stageReviewReport.evidenceDigest ||
    decision.binding.stageIdDigest !== stageReviewReport.npm.stage.idDigest ||
    decision.binding.package !== stageReviewReport.target.package ||
    decision.binding.version !== stageReviewReport.target.version
  ) fail("first_publication_stage_approval_review_mismatch");
  const expiresAt = new Date(Math.min(
    authorized + maximumAuthorizationLifetimeMilliseconds,
    milliseconds(decision.expiresAt),
    observedAt + maximumReviewAgeMilliseconds,
  )).toISOString();
  return {
    schemaVersion: 1,
    status: "approval_authorized",
    authorizationType: "first_publication_npm_stage_approval",
    target: structuredClone(stageReviewReport.target),
    binding: {
      stageReviewEvidenceDigest: stageReviewReport.evidenceDigest,
      stageIdDigest: stageReviewReport.npm.stage.idDigest,
      registry: stageReviewReport.npm.registry,
      distTag: stageReviewReport.npm.stage.distTag,
      artifact: structuredClone(stageReviewReport.npm.tarball),
    },
    decision: {
      decisionId: decision.decisionId,
      decisionDigest: decision.decisionDigest,
      actorKind: "human_operator",
    },
    validity: { authorizedAt, expiresAt },
    authority: {
      operation: "npm_stage_approve_once",
      interactive2FA: "required",
      stageReject: "forbidden",
      directPublish: "forbidden",
      retryAfterAttempt: "forbidden_without_reconciliation",
    },
    sideEffects: {
      files: "authorization_output_created_only",
      npmSettings: "not_changed",
      stageApprove: "not_attempted",
      stageReject: "not_attempted",
      publication: "not_attempted",
    },
  };
}

export function createFirstPublicationStageApprovalAuthorization(input) {
  const body = authorizationBody(input);
  return { ...body, authorizationDigest: canonicalDigest(body) };
}

export function validateFirstPublicationStageApprovalAuthorization(
  authorization,
  input,
  { checkedAt } = {},
) {
  const expected = createFirstPublicationStageApprovalAuthorization(input);
  if (canonicalJson(authorization) !== canonicalJson(expected)) fail();
  if (checkedAt !== undefined) {
    const checked = milliseconds(checkedAt);
    if (
      checked < milliseconds(authorization.validity.authorizedAt) ||
      checked >= milliseconds(authorization.validity.expiresAt)
    ) fail("first_publication_stage_approval_authorization_expired");
  }
  return authorization;
}
