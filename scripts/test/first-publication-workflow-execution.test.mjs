import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { describe, it } from "vitest";

import {
  createFirstPublicationWorkflowExecutionEvidence,
  validateFirstPublicationWorkflowExecutionEvidence,
} from "../lib/first-publication-workflow-execution-evidence.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import {
  createWorkflowExecutionFixture,
  matchingWorkflowExecutionObservation,
  workflowExecutionAttempt,
  workflowExecutionRunId,
} from "./fixtures/first-publication-workflow-execution.mjs";
import { workflowReleaseTag } from "./fixtures/first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from "./fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from "./fixtures/first-publication-workflow-activation.mjs";

function input(fixture, overrides = {}) {
  return {
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    releaseTag: workflowReleaseTag,
    runId: workflowExecutionRunId,
    attempt: workflowExecutionAttempt,
    reachabilityReport: fixture.reachabilityReport,
    workflowExecutionObservation: matchingWorkflowExecutionObservation(),
    observedAt: "2026-08-21T10:13:00Z",
    ...overrides,
  };
}

describe("first-publication workflow execution evidence", () => {
  it("binds the exact latest attempt, terminal stage job, and result artifact metadata", async () => {
    const fixture = await createWorkflowExecutionFixture();
    try {
      const evidenceInput = input(fixture);
      const report = createFirstPublicationWorkflowExecutionEvidence(evidenceInput);
      assert.equal(report.status, "evidence_bound");
      assert.equal(report.target.runId, workflowExecutionRunId);
      assert.equal(report.target.attempt, workflowExecutionAttempt);
      assert.equal(report.github.run.conclusion, "success");
      assert.equal(report.github.job.stage.conclusion, "success");
      assert.equal(report.github.job.resultUpload.conclusion, "success");
      assert.equal(report.github.artifact.expired, false);
      assert.equal(report.limitations.artifactContents, "not_verified");
      assert.equal(report.limitations.npmStageSubmission, "not_observed");
      assert.equal(report.sideEffects.workflowRerun, "not_attempted");
      assert.equal(
        validateFirstPublicationWorkflowExecutionEvidence(report, evidenceInput),
        report,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a different attempt, source, failed job, or expired artifact", async () => {
    const fixture = await createWorkflowExecutionFixture();
    try {
      assert.throws(
        () =>
          createFirstPublicationWorkflowExecutionEvidence(
            input(fixture, {
              attempt: 1,
            }),
          ),
        { code: "first_publication_workflow_execution_observation_invalid" },
      );
      for (const workflowExecutionObservation of [
        matchingWorkflowExecutionObservation({
          run: {
            ...matchingWorkflowExecutionObservation().run,
            headSha: "a".repeat(40),
          },
        }),
        matchingWorkflowExecutionObservation({
          job: {
            ...matchingWorkflowExecutionObservation().job,
            conclusion: "failure",
          },
        }),
        matchingWorkflowExecutionObservation({
          artifact: {
            ...matchingWorkflowExecutionObservation().artifact,
            expired: true,
          },
        }),
      ]) {
        assert.throws(
          () =>
            createFirstPublicationWorkflowExecutionEvidence(
              input(fixture, {
                workflowExecutionObservation,
              }),
            ),
          { code: "first_publication_workflow_execution_observation_invalid" },
        );
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects redigested upstream authority and stronger execution claims", async () => {
    const fixture = await createWorkflowExecutionFixture();
    try {
      const forgedUpstream = structuredClone(fixture.reachabilityReport);
      forgedUpstream.limitations.workflowExecution = "verified";
      const { evidenceDigest: _upstreamDigest, ...upstreamBody } = forgedUpstream;
      forgedUpstream.evidenceDigest = canonicalDigest(upstreamBody);
      assert.throws(
        () =>
          createFirstPublicationWorkflowExecutionEvidence(
            input(fixture, {
              reachabilityReport: forgedUpstream,
            }),
          ),
        { code: "first_publication_workflow_reachability_report_invalid" },
      );

      const evidenceInput = input(fixture);
      const forgedReport = structuredClone(
        createFirstPublicationWorkflowExecutionEvidence(evidenceInput),
      );
      forgedReport.limitations.artifactContents = "verified";
      const { evidenceDigest: _reportDigest, ...reportBody } = forgedReport;
      forgedReport.evidenceDigest = canonicalDigest(reportBody);
      assert.throws(
        () => validateFirstPublicationWorkflowExecutionEvidence(forgedReport, evidenceInput),
        { code: "first_publication_workflow_execution_report_invalid" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
