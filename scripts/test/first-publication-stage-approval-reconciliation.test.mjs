import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { describe, it } from "vitest";

import {
  createFirstPublicationStageApprovalReconciliationReport,
  validateFirstPublicationStageApprovalReconciliationReport,
  validateFirstPublicationStageApprovalReconciliationReportDocument,
} from "../lib/first-publication-stage-approval-reconciliation.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import {
  createFirstPublicationStageApprovalReconciliationFixture,
  matchingPublicReleaseObservation,
  matchingStageApprovalReconciliationObservation,
} from "./fixtures/first-publication-stage-approval-reconciliation.mjs";

function evidence(fixture, observation = matchingStageApprovalReconciliationObservation(fixture)) {
  return {
    stageReviewReport: fixture.stageReviewReport,
    authorization: fixture.authorization,
    attempt: fixture.attempt,
    terminal: fixture.terminal,
    observation,
    observedAt: "2026-08-21T10:20:00Z",
  };
}

describe("first-publication stage approval reconciliation evidence", () => {
  it("confirms only an exact public release with the approved stage absent", async () => {
    const fixture = await createFirstPublicationStageApprovalReconciliationFixture();
    try {
      const input = evidence(fixture);
      const report = createFirstPublicationStageApprovalReconciliationReport(input);
      assert.equal(report.outcome, "public_release_confirmed");
      assert.deepEqual(report.checks.map(({ status }) => status), [
        "matched", "matched", "matched",
      ]);
      assert.equal(report.binding.terminalState, "approval_command_completed");
      assert.equal(report.sideEffects.stageApprove, "not_attempted");
      assert.equal(validateFirstPublicationStageApprovalReconciliationReport(
        report,
        input,
      ), report);
      assert.equal(validateFirstPublicationStageApprovalReconciliationReportDocument(report),
        report);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("distinguishes an unconfirmed approval and keeps inconsistent states unknown", async () => {
    const fixture = await createFirstPublicationStageApprovalReconciliationFixture({
      terminalState: "approval_outcome_unknown",
    });
    try {
      const missing = matchingPublicReleaseObservation(fixture, {
        versionMetadata: { state: "not_found" },
        distTagValue: { state: "not_found" },
      });
      const notConfirmed = createFirstPublicationStageApprovalReconciliationReport(
        evidence(fixture, matchingStageApprovalReconciliationObservation(fixture, {
          publicRelease: missing,
          stage: { state: "present" },
        })),
      );
      assert.equal(notConfirmed.outcome, "approval_not_confirmed");
      assert.equal(notConfirmed.limitations.automaticRetryAuthority, "not_granted");
      const inconsistent = createFirstPublicationStageApprovalReconciliationReport(
        evidence(fixture, matchingStageApprovalReconciliationObservation(fixture, {
          stage: { state: "present" },
        })),
      );
      assert.equal(inconsistent.outcome, "unknown");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects redigested outcome promotion and aborted terminals", async () => {
    const fixture = await createFirstPublicationStageApprovalReconciliationFixture();
    try {
      const report = createFirstPublicationStageApprovalReconciliationReport(evidence(fixture));
      const forged = structuredClone(report);
      forged.outcome = "approval_not_confirmed";
      const { evidenceDigest: _digest, ...body } = forged;
      forged.evidenceDigest = canonicalDigest(body);
      assert.throws(
        () => validateFirstPublicationStageApprovalReconciliationReportDocument(forged),
        { code: "first_publication_stage_approval_reconciliation_report_invalid" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
