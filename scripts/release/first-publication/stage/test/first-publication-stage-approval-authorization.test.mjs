import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { describe, it } from "vitest";

import {
  createFirstPublicationStageApprovalAuthorization,
  validateFirstPublicationStageApprovalAuthorization,
} from "../first-publication-stage-approval-authorization.mjs";
import {
  createFirstPublicationStageApprovalDecision,
  stageApprovalConfirmations,
} from "../first-publication-stage-approval-decision.mjs";
import { canonicalDigest } from "../../../../shared/release-artifact-manifest.mjs";
import { createFirstPublicationStageReviewFixture } from "../../test/fixtures/first-publication-stage-review.mjs";

function decision(report, overrides = {}) {
  return createFirstPublicationStageApprovalDecision({
    decisionId: "nsa_0123456789abcdef01234567",
    stageReviewEvidenceDigest: report.evidenceDigest,
    stageIdDigest: report.npm.stage.idDigest,
    package: report.target.package,
    version: report.target.version,
    decidedAt: "2026-08-21T10:16:00Z",
    expiresAt: "2026-08-21T10:26:00Z",
    ...overrides,
  });
}

describe("first-publication stage approval authorization", () => {
  it("grants one short interactive approval without retaining an actor or stage ID", async () => {
    const fixture = await createFirstPublicationStageReviewFixture();
    try {
      const humanDecision = decision(fixture.stageReviewReport);
      const input = {
        stageReviewReport: fixture.stageReviewReport,
        decision: humanDecision,
        authorizedAt: "2026-08-21T10:16:30Z",
      };
      const authorization = createFirstPublicationStageApprovalAuthorization(input);
      assert.equal(authorization.status, "approval_authorized");
      assert.equal(authorization.authority.operation, "npm_stage_approve_once");
      assert.equal(authorization.authority.interactive2FA, "required");
      assert.equal(authorization.sideEffects.stageApprove, "not_attempted");
      assert.equal(authorization.validity.expiresAt, "2026-08-21T10:21:30.000Z");
      assert.equal(JSON.stringify(authorization).includes("123e4567"), false);
      assert.equal(
        validateFirstPublicationStageApprovalAuthorization(authorization, input, {
          checkedAt: "2026-08-21T10:17:00Z",
        }),
        authorization,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects stale review, mismatched binding, expired decisions, and stronger claims", async () => {
    const fixture = await createFirstPublicationStageReviewFixture();
    try {
      const humanDecision = decision(fixture.stageReviewReport);
      const legacy = structuredClone(fixture.stageReviewReport);
      legacy.schemaVersion = 1;
      delete legacy.upstream.publicationAuthorizationDigest;
      const { evidenceDigest: _legacyDigest, ...legacyBody } = legacy;
      legacy.evidenceDigest = canonicalDigest(legacyBody);
      assert.throws(
        () =>
          createFirstPublicationStageApprovalAuthorization({
            stageReviewReport: legacy,
            decision: decision(legacy),
            authorizedAt: "2026-08-21T10:16:30Z",
          }),
        { code: "first_publication_stage_approval_review_mismatch" },
      );
      assert.throws(
        () =>
          createFirstPublicationStageApprovalAuthorization({
            stageReviewReport: fixture.stageReviewReport,
            decision: humanDecision,
            authorizedAt: "2026-08-21T10:25:01Z",
          }),
        { code: "first_publication_stage_approval_review_mismatch" },
      );
      assert.throws(
        () =>
          createFirstPublicationStageApprovalAuthorization({
            stageReviewReport: fixture.stageReviewReport,
            decision: decision(fixture.stageReviewReport, {
              stageIdDigest: `sha256:${"f".repeat(64)}`,
            }),
            authorizedAt: "2026-08-21T10:16:30Z",
          }),
        { code: "first_publication_stage_approval_review_mismatch" },
      );
      assert.throws(() =>
        createFirstPublicationStageApprovalAuthorization({
          stageReviewReport: fixture.stageReviewReport,
          decision: humanDecision,
          authorizedAt: "2026-08-21T10:26:00Z",
        }),
      );
      const validInput = {
        stageReviewReport: fixture.stageReviewReport,
        decision: humanDecision,
        authorizedAt: "2026-08-21T10:16:30Z",
      };
      const forged = structuredClone(createFirstPublicationStageApprovalAuthorization(validInput));
      forged.authority.stageReject = "allowed";
      const { authorizationDigest: _digest, ...body } = forged;
      forged.authorizationDigest = canonicalDigest(body);
      assert.throws(() => validateFirstPublicationStageApprovalAuthorization(forged, validInput), {
        code: "first_publication_stage_approval_authorization_invalid",
      });
      assert.equal(stageApprovalConfirmations.includes("approve_makes_package_public"), true);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
