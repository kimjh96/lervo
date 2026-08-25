import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { inspectCliFirstPublicationCompletion } from "../lib/cli-first-publication-completion-inspection.mjs";
import {
  createFirstPublicationCompletionInspection,
  validateFirstPublicationCompletionInspectionDocument,
} from "../lib/first-publication-completion-inspection.mjs";
import { readFirstPublicationCompletionInspectionSources } from "../lib/first-publication-completion-inspection-sources.mjs";
import { formatFirstPublicationCompletionInspection } from "../lib/first-publication-completion-inspection-formatter.mjs";
import { createCliFirstPublicationStageEvidenceBundle } from "../lib/cli-first-publication-stage-evidence-bundle.mjs";
import { createFirstPublicationStageApprovalReconciliationReport } from "../lib/first-publication-stage-approval-reconciliation.mjs";
import { createFirstPublicationTransitionReceipt } from "../lib/first-publication-transition.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import { createFirstPublicationFixture } from "./fixtures/first-publication.mjs";
import {
  createFirstPublicationStageApprovalReconciliationFixture,
  matchingStageApprovalReconciliationObservation,
} from "./fixtures/first-publication-stage-approval-reconciliation.mjs";
import { createFirstPublicationTransitionControls } from "./fixtures/first-publication-transition.mjs";
import { workflowRemoteSourceCommit } from "./fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowReleaseVersion } from "./fixtures/first-publication-workflow-reachability.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function fixture() {
  const stage = await createFirstPublicationStageApprovalReconciliationFixture();
  const source = createFirstPublicationFixture({
    version: workflowReleaseVersion,
    sourceDigest: workflowRemoteSourceCommit,
  });
  const reconciliationReport = createFirstPublicationStageApprovalReconciliationReport({
    stageReviewReport: stage.stageReviewReport,
    authorization: stage.authorization,
    attempt: stage.attempt,
    terminal: stage.terminal,
    observation: matchingStageApprovalReconciliationObservation(stage),
    observedAt: "2026-08-21T10:20:00Z",
  });
  const publicationEvidence = {
    type: "stage_approval_reconciliation",
    reconciliationReport,
    stageReviewReport: stage.stageReviewReport,
    decision: stage.decision,
    authorization: stage.authorization,
    attempt: stage.attempt,
    terminal: stage.terminal,
  };
  const controls = {
    ...createFirstPublicationTransitionControls(source, publicationEvidence),
    armingAuthorization: undefined,
    observedAt: "2026-08-21T10:21:00Z",
  };
  const transitionReceipt = createFirstPublicationTransitionReceipt({
    ...controls,
    completedAt: controls.observedAt,
  });
  const reconciliationReportPath = resolve(stage.root, "reconciliation.json");
  const bundlePath = resolve(stage.root, "stage-evidence-bundle.json");
  const transitionReceiptPath = resolve(stage.root, "transition-receipt.json");
  await Promise.all([
    writeFile(reconciliationReportPath, `${JSON.stringify(reconciliationReport, null, 2)}\n`),
    writeFile(transitionReceiptPath, `${JSON.stringify(transitionReceipt, null, 2)}\n`),
  ]);
  await createCliFirstPublicationStageEvidenceBundle({
    stageReviewReportPath: stage.stageReviewReportPath,
    decisionPath: stage.decisionPath,
    authorizationPath: stage.authorizationPath,
    resultDirectory: stage.resultDirectory,
    reconciliationReportPath,
    outputPath: bundlePath,
    write: true,
  });
  return {
    stage,
    source,
    reconciliationReport,
    transitionReceipt,
    bundlePath,
    transitionReceiptPath,
    options: { stageApprovalBundlePath: bundlePath, transitionReceiptPath },
  };
}

describe("first-publication completion inspection", () => {
  it("reports recorded completion with no remaining transition action", async () => {
    const value = await fixture();
    try {
      const beforeBundle = await readFile(value.bundlePath);
      const beforeReceipt = await readFile(value.transitionReceiptPath);
      const report = await inspectCliFirstPublicationCompletion(value.options, {
        clock: () => "2026-08-21T10:22:00Z",
      });
      assert.equal(report.status, "completion_recorded");
      assert.equal(report.completion.state, "completed");
      assert.equal(report.provenance.publicationEvidence.type, "stage_approval_reconciliation");
      assert.deepEqual(report.remainingManualActions, []);
      assert.equal(report.limitations.bootstrapSource, "not_reloaded");
      assert.equal(report.limitations.currentPublicRegistry, "not_reobserved");
      assert.deepEqual(await readFile(value.bundlePath), beforeBundle);
      assert.deepEqual(await readFile(value.transitionReceiptPath), beforeReceipt);

      const text = formatFirstPublicationCompletionInspection(report);
      assert.match(text, /Remaining manual actions: none/u);
      assert.match(text, /external state: not queried again/u);
      assert.equal(text.includes("sha256:"), false);
      assert.equal(text.includes(value.stage.root), false);
    } finally {
      await rm(value.stage.root, { recursive: true, force: true });
    }
  });

  it("rejects a redigested receipt that points at different stage evidence", async () => {
    const value = await fixture();
    try {
      const forged = structuredClone(value.transitionReceipt);
      forged.publicationEvidence.digest = `sha256:${"f".repeat(64)}`;
      const { transitionReceiptDigest: _digest, ...body } = forged;
      forged.transitionReceiptDigest = canonicalDigest(body);
      await writeFile(value.transitionReceiptPath, `${JSON.stringify(forged, null, 2)}\n`);
      await assert.rejects(
        inspectCliFirstPublicationCompletion(value.options, {
          clock: () => "2026-08-21T10:22:00Z",
        }),
        { code: "first_publication_completion_inspection_invalid" },
      );
    } finally {
      await rm(value.stage.root, { recursive: true, force: true });
    }
  });

  it("rejects source races and redigested stronger inspection claims", async () => {
    const value = await fixture();
    try {
      await assert.rejects(
        inspectCliFirstPublicationCompletion(value.options, {
          readSources: async (options, dependencies) => {
            const sources = await readFirstPublicationCompletionInspectionSources(
              options,
              dependencies,
            );
            return {
              ...sources,
              assertUnchanged: async () => {
                await writeFile(value.transitionReceiptPath, "{}\n");
                await sources.assertUnchanged();
              },
            };
          },
          clock: () => "2026-08-21T10:22:00Z",
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(value.stage.root, { recursive: true, force: true });
    }

    const stronger = await fixture();
    try {
      const sources = await readFirstPublicationCompletionInspectionSources(stronger.options);
      const report = createFirstPublicationCompletionInspection({
        ...sources,
        inspectedAt: "2026-08-21T10:22:00Z",
      });
      const promoted = structuredClone(report);
      promoted.limitations.currentPublicRegistry = "verified_current";
      const { inspectionDigest: _digest, ...body } = promoted;
      promoted.inspectionDigest = canonicalDigest(body);
      assert.throws(() => validateFirstPublicationCompletionInspectionDocument(promoted), {
        code: "first_publication_completion_inspection_invalid",
      });
    } finally {
      await rm(stronger.stage.root, { recursive: true, force: true });
    }
  });

  it("provides one read-only CLI with strict arguments", async () => {
    const value = await fixture();
    try {
      const valid = [
        "--stage-approval-bundle",
        value.bundlePath,
        "--transition-receipt",
        value.transitionReceiptPath,
        "--json",
      ];
      const success = spawnSync(
        process.execPath,
        ["scripts/inspect-cli-first-publication-completion.mjs", ...valid],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(success.status, 0);
      assert.equal(JSON.parse(success.stdout).status, "completion_recorded");
      assert.equal(success.stderr, "");

      for (const args of [
        [],
        valid.slice(0, -3),
        valid.map((item) => (item === value.bundlePath ? "bundle.json" : item)),
        [...valid, "--json"],
        [...valid, "--online"],
        [...valid, "--write"],
      ]) {
        const result = spawnSync(
          process.execPath,
          ["scripts/inspect-cli-first-publication-completion.mjs", ...args],
          { cwd: repositoryRoot, encoding: "utf8" },
        );
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /^first_publication_completion_inspection_arguments_invalid:/u);
      }
    } finally {
      await rm(value.stage.root, { recursive: true, force: true });
    }
  });
});
