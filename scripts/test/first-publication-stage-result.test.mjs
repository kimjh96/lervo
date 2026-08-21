import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { describe, it } from "vitest";

import {
  createFirstPublicationStageResultEvidence,
  validateFirstPublicationStageResultEvidence,
} from "../lib/first-publication-stage-result-evidence.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import {
  createFirstPublicationStageResultFixture,
  matchingStageResultObservation,
} from "./fixtures/first-publication-stage-result.mjs";
import {
  workflowExecutionAttempt,
  workflowExecutionRunId,
} from "./fixtures/first-publication-workflow-execution.mjs";
import { workflowReleaseTag } from
  "./fixtures/first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from
  "./fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from
  "./fixtures/first-publication-workflow-activation.mjs";

function input(fixture, overrides = {}) {
  return {
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    releaseTag: workflowReleaseTag,
    runId: workflowExecutionRunId,
    attempt: workflowExecutionAttempt,
    workflowExecutionReport: fixture.workflowExecutionReport,
    stageResultObservation: matchingStageResultObservation(fixture),
    observedAt: "2026-08-21T10:14:00Z",
    ...overrides,
  };
}

describe("first-publication npm stage result evidence", () => {
  it("binds downloaded records while limiting the claim to npm CLI exit zero", async () => {
    const fixture = await createFirstPublicationStageResultFixture();
    try {
      const evidenceInput = input(fixture);
      const report = createFirstPublicationStageResultEvidence(evidenceInput);
      assert.equal(report.status, "evidence_bound");
      assert.equal(report.stageResult,
        "npm_cli_reported_stage_submission_accepted");
      assert.equal(report.stage.receiptEvidence, "npm_cli_exit_zero");
      assert.equal(report.stage.review, "required_with_2fa");
      assert.equal(report.limitations.npmStageSubmissionProof,
        "npm_cli_exit_zero_only");
      assert.equal(report.limitations.npmTwoFactorApproval, "not_observed");
      assert.equal(report.sideEffects.artifactDownload, "performed_read_only");
      assert.equal(validateFirstPublicationStageResultEvidence(report, evidenceInput), report);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects unknown outcomes and package versions different from the workflow target", async () => {
    for (const [options, code] of [
      [{ terminalState: "stage_outcome_unknown" },
        "first_publication_stage_result_record_invalid"],
      [{ version: "0.1.1" }, "first_publication_stage_result_source_mismatch"],
    ]) {
      const fixture = await createFirstPublicationStageResultFixture(options);
      try {
        assert.throws(
          () => createFirstPublicationStageResultEvidence(input(fixture)),
          { code },
        );
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    }
  });

  it("rejects upstream redigest authority and stronger stage claims", async () => {
    const fixture = await createFirstPublicationStageResultFixture();
    try {
      const forgedUpstream = structuredClone(fixture.workflowExecutionReport);
      forgedUpstream.limitations.artifactContents = "verified";
      const { evidenceDigest: _upstreamDigest, ...upstreamBody } = forgedUpstream;
      forgedUpstream.evidenceDigest = canonicalDigest(upstreamBody);
      assert.throws(
        () => createFirstPublicationStageResultEvidence(input(fixture, {
          workflowExecutionReport: forgedUpstream,
        })),
        { code: "first_publication_workflow_execution_report_invalid" },
      );

      const evidenceInput = input(fixture);
      const forgedReport = structuredClone(
        createFirstPublicationStageResultEvidence(evidenceInput),
      );
      forgedReport.limitations.npmTwoFactorApproval = "verified";
      const { evidenceDigest: _reportDigest, ...reportBody } = forgedReport;
      forgedReport.evidenceDigest = canonicalDigest(reportBody);
      assert.throws(
        () => validateFirstPublicationStageResultEvidence(forgedReport, evidenceInput),
        { code: "first_publication_stage_result_report_invalid" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
