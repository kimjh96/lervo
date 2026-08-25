import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createCliFirstPublicationWorkflowExecutionEvidence } from "../lib/cli-first-publication-workflow-execution.mjs";
import { parseFirstPublicationWorkflowExecutionArguments } from "../lib/first-publication-workflow-execution-cli-arguments.mjs";
import { formatFirstPublicationWorkflowExecutionEvidence } from "../lib/first-publication-workflow-execution-formatter.mjs";
import {
  createWorkflowExecutionFixture,
  matchingWorkflowExecutionObservation,
  workflowExecutionAttempt,
  workflowExecutionRunId,
} from "./fixtures/first-publication-workflow-execution.mjs";
import { workflowReleaseTag } from "./fixtures/first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from "./fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from "./fixtures/first-publication-workflow-activation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function createEvidence(fixture, overrides = {}) {
  return createCliFirstPublicationWorkflowExecutionEvidence(
    {
      repository: workflowActivationRepository,
      sourceCommit: workflowRemoteSourceCommit,
      releaseTag: workflowReleaseTag,
      runId: workflowExecutionRunId,
      attempt: workflowExecutionAttempt,
      reachabilityReportPath: fixture.reachabilityReportPath,
      online: true,
    },
    {
      observeExecution: async () => matchingWorkflowExecutionObservation(),
      clock: () => "2026-08-21T10:13:00Z",
      ...overrides,
    },
  );
}

describe("first-publication workflow execution command", () => {
  it("reads execution evidence without changing the upstream source", async () => {
    const fixture = await createWorkflowExecutionFixture();
    try {
      const before = await readFile(fixture.reachabilityReportPath);
      const report = await createEvidence(fixture);
      assert.equal(report.execution, "exact_attempt_completed_success_with_stage_result_artifact");
      assert.deepEqual(await readFile(fixture.reachabilityReportPath), before);
      const output = formatFirstPublicationWorkflowExecutionEvidence(report);
      assert.match(output, /both the workflow and stage job completed successfully/u);
      assert.match(
        output,
        /artifact contents, npm stage acceptance, 2FA approval, public distribution/u,
      );
      assert.equal(output.includes(report.evidenceDigest), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects source changes and unavailable execution observations", async () => {
    const fixture = await createWorkflowExecutionFixture();
    try {
      await assert.rejects(
        createEvidence(fixture, {
          observeExecution: async () => {
            await writeFile(fixture.reachabilityReportPath, "{}\n");
            return matchingWorkflowExecutionObservation();
          },
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
    const unavailableFixture = await createWorkflowExecutionFixture();
    try {
      await assert.rejects(
        createEvidence(unavailableFixture, {
          observeExecution: async () => ({
            schemaVersion: 1,
            source: "github_actions_workflow_execution",
            state: "unavailable",
            reason: "run_changed",
          }),
        }),
        { code: "first_publication_workflow_execution_not_ready" },
      );
    } finally {
      await rm(unavailableFixture.root, { recursive: true, force: true });
    }
  });

  it("parses only exact read-only online coordinates", () => {
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
      "--reachability-report",
      "/tmp/reachability.json",
      "--online",
      "--json",
    ];
    assert.equal(
      parseFirstPublicationWorkflowExecutionArguments(valid).runId,
      workflowExecutionRunId,
    );
    for (const args of [
      [],
      valid.filter((value) => value !== "--online"),
      valid.map((value) => (value === String(workflowExecutionRunId) ? "0" : value)),
      valid.map((value) => (value === "/tmp/reachability.json" ? "relative" : value)),
      [...valid, "--write"],
      [...valid, "--attempt", "3"],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/show-cli-first-publication-workflow-execution-evidence.mjs", ...args],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^first_publication_workflow_execution_arguments_invalid:/u);
    }
  });
});
