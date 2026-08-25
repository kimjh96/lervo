import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { reconcileCliFirstPublicationStageApproval } from "../lib/cli-first-publication-stage-approval-reconciliation.mjs";
import { parseFirstPublicationStageApprovalReconciliationArguments } from "../lib/first-publication-stage-approval-reconciliation-cli-arguments.mjs";
import { formatFirstPublicationStageApprovalReconciliation } from "../lib/first-publication-stage-approval-reconciliation-formatter.mjs";
import {
  createFirstPublicationStageApprovalReconciliationFixture,
  matchingStageApprovalReconciliationObservation,
} from "./fixtures/first-publication-stage-approval-reconciliation.mjs";
import {
  workflowExecutionAttempt,
  workflowExecutionRunId,
} from "./fixtures/first-publication-workflow-execution.mjs";
import { workflowReleaseTag } from "./fixtures/first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from "./fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from "./fixtures/first-publication-workflow-activation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function input(fixture) {
  return {
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    releaseTag: workflowReleaseTag,
    runId: workflowExecutionRunId,
    attempt: workflowExecutionAttempt,
    stageReviewReportPath: fixture.stageReviewReportPath,
    decisionPath: fixture.decisionPath,
    authorizationPath: fixture.authorizationPath,
    npmUserConfigPath: fixture.npmUserConfigPath,
    resultDirectory: fixture.resultDirectory,
    online: true,
  };
}

describe("first-publication stage approval reconciliation command", () => {
  it("reads success records without changing them and returns advisory evidence", async () => {
    const fixture = await createFirstPublicationStageApprovalReconciliationFixture();
    try {
      const report = await reconcileCliFirstPublicationStageApproval(input(fixture), {
        observe: async () => matchingStageApprovalReconciliationObservation(fixture),
        clock: () => "2026-08-21T10:20:00Z",
      });
      assert.equal(report.outcome, "public_release_confirmed");
      assert.match(
        formatFirstPublicationStageApprovalReconciliation(report),
        /Retry authorization: none/u,
      );
      await writeFile(fixture.authorizationPath, "{}\n");
      await assert.rejects(
        reconcileCliFirstPublicationStageApproval(input(fixture), {
          observe: async () => matchingStageApprovalReconciliationObservation(fixture),
          clock: () => "2026-08-21T10:20:00Z",
        }),
        { code: "first_publication_stage_approval_authorization_invalid" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects unavailable observations and write-like arguments", async () => {
    const fixture = await createFirstPublicationStageApprovalReconciliationFixture();
    try {
      await assert.rejects(
        reconcileCliFirstPublicationStageApproval(input(fixture), {
          observe: async () => ({
            schemaVersion: 1,
            source: "npm_stage_approval_reconciliation",
            state: "unavailable",
            reason: "stage_list_changed",
          }),
        }),
        { code: "first_publication_stage_approval_reconciliation_not_ready" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
    const valid = [
      "--repository",
      workflowActivationRepository,
      "--source-commit",
      workflowRemoteSourceCommit,
      "--release-tag",
      workflowReleaseTag,
      "--run-id",
      String(workflowExecutionRunId),
      "--attempt",
      String(workflowExecutionAttempt),
      "--stage-review-report",
      "/tmp/review.json",
      "--decision",
      "/tmp/decision.json",
      "--authorization",
      "/tmp/authorization.json",
      "--npm-user-config",
      "/tmp/user.npmrc",
      "--result-directory",
      "/tmp/result",
      "--online",
      "--json",
    ];
    assert.equal(parseFirstPublicationStageApprovalReconciliationArguments(valid).online, true);
    for (const args of [
      [],
      valid.filter((value) => value !== "--online"),
      [...valid, "--write"],
      [...valid, "--approve"],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/reconcile-cli-first-publication-stage-approval.mjs", ...args],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /^first_publication_stage_approval_reconciliation_arguments_invalid:/u,
      );
    }
  });
});
