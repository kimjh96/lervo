import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { authorizeCliFirstPublicationStageApproval } from "../lib/cli-first-publication-stage-approval.mjs";
import { parseFirstPublicationStageApprovalArguments } from "../lib/first-publication-stage-approval-cli-arguments.mjs";
import { createFirstPublicationStageApprovalDecision } from "../lib/first-publication-stage-approval-decision.mjs";
import { formatFirstPublicationStageApprovalAuthorization } from "../lib/first-publication-stage-approval-formatter.mjs";
import { createFirstPublicationStageReviewFixture } from "./fixtures/first-publication-stage-review.mjs";
import {
  workflowExecutionAttempt,
  workflowExecutionRunId,
} from "./fixtures/first-publication-workflow-execution.mjs";
import { workflowReleaseTag } from "./fixtures/first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from "./fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from "./fixtures/first-publication-workflow-activation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function fixture() {
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
  const decisionPath = resolve(value.root, "stage-approval-decision.json");
  const outputPath = resolve(value.root, "stage-approval-authorization.json");
  await writeFile(decisionPath, `${JSON.stringify(decision, null, 2)}\n`);
  return { ...value, decision, decisionPath, outputPath };
}

function input(value) {
  return {
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    releaseTag: workflowReleaseTag,
    runId: workflowExecutionRunId,
    attempt: workflowExecutionAttempt,
    stageReviewReportPath: value.stageReviewReportPath,
    decisionPath: value.decisionPath,
    outputPath: value.outputPath,
    write: true,
  };
}

describe("first-publication stage approval authorization command", () => {
  it("writes one immutable authorization after rechecking both sources", async () => {
    const value = await fixture();
    try {
      const reportBefore = await readFile(value.stageReviewReportPath);
      const decisionBefore = await readFile(value.decisionPath);
      const authorization = await authorizeCliFirstPublicationStageApproval(input(value), {
        clock: () => "2026-08-21T10:16:30Z",
      });
      assert.deepEqual(JSON.parse(await readFile(value.outputPath, "utf8")), authorization);
      assert.deepEqual(await readFile(value.stageReviewReportPath), reportBefore);
      assert.deepEqual(await readFile(value.decisionPath), decisionBefore);
      assert.match(
        formatFirstPublicationStageApprovalAuthorization(authorization),
        /npm approve, reject, and public-status checks have not been performed/u,
      );
      await assert.rejects(
        authorizeCliFirstPublicationStageApproval(input(value), {
          clock: () => "2026-08-21T10:16:30Z",
        }),
        { code: "first_publication_stage_approval_output_exists" },
      );
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  it("rejects source races before creating the authorization output", async () => {
    const value = await fixture();
    try {
      await assert.rejects(
        authorizeCliFirstPublicationStageApproval(input(value), {
          clock: () => "2026-08-21T10:16:30Z",
          readSources: async (...args) => {
            const { readFirstPublicationStageApprovalAuthorizationSources } =
              await import("../lib/first-publication-stage-approval-sources.mjs");
            const sources = await readFirstPublicationStageApprovalAuthorizationSources(...args);
            return {
              ...sources,
              assertUnchanged: async () => {
                await writeFile(value.decisionPath, "{}\n");
                await sources.assertUnchanged();
              },
            };
          },
        }),
        { code: "release_attestation_release_set_changed" },
      );
      await assert.rejects(readFile(value.outputPath));
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  it("accepts only exact write coordinates and absolute paths", () => {
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
      "/tmp/stage-review.json",
      "--decision",
      "/tmp/decision.json",
      "--output",
      "/tmp/authorization.json",
      "--write",
      "--json",
    ];
    assert.equal(parseFirstPublicationStageApprovalArguments(valid).write, true);
    for (const args of [
      [],
      valid.filter((value) => value !== "--write"),
      valid.map((value) => (value === "/tmp/decision.json" ? "relative" : value)),
      [...valid, "--online"],
      [...valid, "--output", "/tmp/other.json"],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/authorize-cli-first-publication-stage-approval.mjs", ...args],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^first_publication_stage_approval_arguments_invalid:/u);
    }
  });
});
