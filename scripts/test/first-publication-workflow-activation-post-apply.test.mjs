import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { readFirstPublicationWorkflowActivationPostApplySources } from
  "../lib/first-publication-workflow-activation-post-apply-sources.mjs";
import {
  createFirstPublicationWorkflowActivationPostApplyReport,
  validateFirstPublicationWorkflowActivationPostApplyReport,
} from "../lib/first-publication-workflow-activation-post-apply-verification.mjs";
import { validateFirstPublicationWorkflowActivationReceiptDocument } from
  "../lib/first-publication-workflow-activation-receipt.mjs";
import { canonicalDigest, sha256 } from "../lib/release-artifact-manifest.mjs";
import {
  createAppliedWorkflowActivationFixture,
  readyWorkflowActivationGitHubObservation,
  readyWorkflowActivationNpmObservation,
  workflowActivationRepository,
} from "./fixtures/first-publication-workflow-activation.mjs";

async function reportInput(fixture) {
  const sources = await readFirstPublicationWorkflowActivationPostApplySources(
    fixture.paths,
    fixture.receiptPath,
  );
  return {
    ...sources,
    repository: workflowActivationRepository,
    npmObservation: readyWorkflowActivationNpmObservation(),
    githubObservation: readyWorkflowActivationGitHubObservation(),
    observedAt: "2026-08-21T10:06:00Z",
    transactionState: { status: "clear" },
  };
}

describe("first-publication workflow activation post-apply report", () => {
  it("verifies local stage-only bytes and fresh controls without claiming execution", async () => {
    const fixture = await createAppliedWorkflowActivationFixture();
    try {
      const input = await reportInput(fixture);
      const report = createFirstPublicationWorkflowActivationPostApplyReport(input);
      assert.equal(report.status, "verified");
      assert.equal(report.localActivation, "stage_only_workflow_present");
      assert.equal(report.checks.every(({ status }) => status === "ready"), true);
      assert.equal(report.limitations.receiptAuthenticity, "not_verified");
      assert.equal(report.limitations.reviewedCandidateProvenance, "receipt_binding_only");
      assert.equal(report.limitations.remoteWorkflowDeployment, "not_verified");
      assert.equal(report.limitations.workflowExecution, "not_observed");
      assert.equal(report.limitations.stageSubmission, "not_observed");
      assert.equal(report.sideEffects.publication, "not_attempted");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects redigested receipt authority and a stronger report claim", async () => {
    const fixture = await createAppliedWorkflowActivationFixture();
    try {
      const forgedReceipt = structuredClone(fixture.receipt);
      forgedReceipt.publication = "attempted";
      const { receiptDigest: _receiptDigest, ...receiptBody } = forgedReceipt;
      forgedReceipt.receiptDigest = canonicalDigest(receiptBody);
      assert.throws(
        () => validateFirstPublicationWorkflowActivationReceiptDocument(forgedReceipt),
        { code: "first_publication_workflow_activation_receipt_invalid" },
      );

      const input = await reportInput(fixture);
      const forgedReport = structuredClone(
        createFirstPublicationWorkflowActivationPostApplyReport(input),
      );
      forgedReport.limitations.remoteWorkflowDeployment = "verified";
      const { reportDigest: _reportDigest, ...reportBody } = forgedReport;
      forgedReport.reportDigest = canonicalDigest(reportBody);
      assert.throws(
        () => validateFirstPublicationWorkflowActivationPostApplyReport(
          forgedReport,
          input,
        ),
        { code: "first_publication_workflow_activation_post_apply_report_invalid" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects current workflow bytes that no longer match the receipt", async () => {
    const fixture = await createAppliedWorkflowActivationFixture();
    try {
      await writeFile(fixture.paths.workflowPath, fixture.workflowContents);
      const input = await reportInput(fixture);
      assert.throws(
        () => createFirstPublicationWorkflowActivationPostApplyReport(input),
        { code: "first_publication_workflow_activation_post_apply_source_mismatch" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not let a redigested receipt bless a changed action SHA", async () => {
    const fixture = await createAppliedWorkflowActivationFixture();
    try {
      const current = await readFile(fixture.paths.workflowPath, "utf8");
      const changed = Buffer.from(current.replaceAll(
        "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
        `actions/checkout@${"b".repeat(40)}`,
      ));
      await writeFile(fixture.paths.workflowPath, changed);
      const forgedReceipt = structuredClone(fixture.receipt);
      forgedReceipt.workflow = {
        byteCount: changed.length,
        sha256: sha256(changed),
      };
      const { receiptDigest: _receiptDigest, ...receiptBody } = forgedReceipt;
      forgedReceipt.receiptDigest = canonicalDigest(receiptBody);
      await writeFile(
        fixture.receiptPath,
        `${JSON.stringify(forgedReceipt, null, 2)}\n`,
      );
      const input = await reportInput(fixture);
      assert.throws(
        () => createFirstPublicationWorkflowActivationPostApplyReport(input),
        { code: "first_publication_workflow_activation_post_apply_not_ready" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
