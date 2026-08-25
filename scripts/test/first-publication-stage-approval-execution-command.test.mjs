import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { executeCliFirstPublicationStageApproval } from "../lib/cli-first-publication-stage-approval-execution.mjs";
import { parseFirstPublicationStageApprovalExecutionArguments } from "../lib/first-publication-stage-approval-execution-cli-arguments.mjs";
import { formatFirstPublicationStageApprovalExecution } from "../lib/first-publication-stage-approval-execution-formatter.mjs";
import { createFirstPublicationStageApprovalFixture } from "./fixtures/first-publication-stage-approval.mjs";
import {
  workflowExecutionAttempt,
  workflowExecutionRunId,
} from "./fixtures/first-publication-workflow-execution.mjs";
import { workflowReleaseTag } from "./fixtures/first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from "./fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from "./fixtures/first-publication-workflow-activation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function fixture() {
  const value = await createFirstPublicationStageApprovalFixture();
  const decisionPath = resolve(value.root, "decision.json");
  const authorizationPath = resolve(value.root, "authorization.json");
  await writeFile(decisionPath, `${JSON.stringify(value.decision, null, 2)}\n`);
  await writeFile(authorizationPath, `${JSON.stringify(value.authorization, null, 2)}\n`);
  return {
    ...value,
    decisionPath,
    authorizationPath,
    resultDirectory: resolve(value.root, "approval-result"),
  };
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
    authorizationPath: value.authorizationPath,
    npmUserConfigPath: value.npmUserConfigPath,
    resultDirectory: value.resultDirectory,
    online: true,
    write: true,
  };
}

describe("first-publication stage approval execution command", () => {
  it("recomputes authorization sources and invokes one injected interactive approval", async () => {
    const value = await fixture();
    let approvals = 0;
    try {
      const clock = (() => {
        const values = [
          "2026-08-21T10:16:31Z",
          "2026-08-21T10:17:00Z",
          "2026-08-21T10:17:01Z",
          "2026-08-21T10:18:00Z",
        ];
        return () => values.shift();
      })();
      const terminal = await executeCliFirstPublicationStageApproval(input(value), {
        prepareApproval: async () => ({
          recheck: async () => {},
          approve: async () => {
            approvals += 1;
          },
          dispose: async () => {},
        }),
        clock,
      });
      assert.equal(approvals, 1);
      assert.equal(terminal.state, "approval_command_completed");
      assert.equal(
        JSON.parse(await readFile(resolve(value.resultDirectory, "terminal.json"), "utf8"))
          .publicAvailability,
        "not_claimed",
      );
      assert.match(
        formatFirstPublicationStageApprovalExecution(terminal),
        /separate registry verification is still required/u,
      );
      await assert.rejects(
        executeCliFirstPublicationStageApproval(input(value), {
          prepareApproval: async () => ({
            recheck: async () => {},
            approve: async () => {
              approvals += 1;
            },
            dispose: async () => {},
          }),
          clock: () => "2026-08-21T10:17:00Z",
        }),
        { code: "first_publication_stage_approval_already_attempted" },
      );
      assert.equal(approvals, 1);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  it("accepts only explicit online write authority and absolute paths", () => {
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
      "--write",
      "--json",
    ];
    assert.equal(parseFirstPublicationStageApprovalExecutionArguments(valid).online, true);
    for (const args of [
      [],
      valid.filter((value) => value !== "--online"),
      valid.filter((value) => value !== "--write"),
      valid.map((value) => (value === "/tmp/user.npmrc" ? "relative" : value)),
      [...valid, "--reject"],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/approve-cli-first-publication-stage.mjs", ...args],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(
        result.stderr,
        /^first_publication_stage_approval_execution_arguments_invalid:/u,
      );
    }
  });
});
