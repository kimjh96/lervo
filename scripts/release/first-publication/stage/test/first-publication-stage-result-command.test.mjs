import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createCliFirstPublicationStageResultEvidence } from "../cli-first-publication-stage-result.mjs";
import { parseFirstPublicationStageResultArguments } from "../first-publication-stage-result-cli-arguments.mjs";
import { formatFirstPublicationStageResultEvidence } from "../first-publication-stage-result-formatter.mjs";
import {
  createFirstPublicationStageResultFixture,
  matchingStageResultObservation,
} from "../../test/fixtures/first-publication-stage-result.mjs";
import {
  workflowExecutionAttempt,
  workflowExecutionRunId,
} from "../../test/fixtures/first-publication-workflow-execution.mjs";
import { workflowReleaseTag } from "../../test/fixtures/first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from "../../test/fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from "../../test/fixtures/first-publication-workflow-activation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../../..");

function createEvidence(fixture, overrides = {}) {
  return createCliFirstPublicationStageResultEvidence(
    {
      repository: workflowActivationRepository,
      sourceCommit: workflowRemoteSourceCommit,
      releaseTag: workflowReleaseTag,
      runId: workflowExecutionRunId,
      attempt: workflowExecutionAttempt,
      workflowExecutionReportPath: fixture.workflowExecutionReportPath,
      online: true,
    },
    {
      observeStageResult: async () => matchingStageResultObservation(fixture),
      clock: () => "2026-08-21T10:14:00Z",
      ...overrides,
    },
  );
}

describe("first-publication npm stage result command", () => {
  it("downloads through the injected observer without changing the source report", async () => {
    const fixture = await createFirstPublicationStageResultFixture();
    try {
      const before = await readFile(fixture.workflowExecutionReportPath);
      const report = await createEvidence(fixture);
      assert.equal(report.stage.state, "staged");
      assert.deepEqual(await readFile(fixture.workflowExecutionReportPath), before);
      const output = formatFirstPublicationStageResultEvidence(report);
      assert.match(output, /npm CLI completed the stage request with exit code 0/u);
      assert.match(output, /not independent registry acceptance evidence or 2FA approval/u);
      assert.equal(output.includes(report.evidenceDigest), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects source races and unavailable downloads", async () => {
    const fixture = await createFirstPublicationStageResultFixture();
    try {
      await assert.rejects(
        createEvidence(fixture, {
          observeStageResult: async () => {
            await writeFile(fixture.workflowExecutionReportPath, "{}\n");
            return matchingStageResultObservation(fixture);
          },
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
    const unavailable = await createFirstPublicationStageResultFixture();
    try {
      await assert.rejects(
        createEvidence(unavailable, {
          observeStageResult: async () => ({
            schemaVersion: 1,
            source: "github_stage_result_artifact",
            state: "unavailable",
            reason: "artifact_changed",
          }),
        }),
        { code: "first_publication_stage_result_not_ready" },
      );
    } finally {
      await rm(unavailable.root, { recursive: true, force: true });
    }
  });

  it("accepts only complete read-only online coordinates", () => {
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
      "--workflow-execution-report",
      "/tmp/workflow-execution.json",
      "--online",
      "--json",
    ];
    assert.equal(
      parseFirstPublicationStageResultArguments(valid).attempt,
      workflowExecutionAttempt,
    );
    for (const args of [
      [],
      valid.filter((value) => value !== "--online"),
      valid.map((value) => (value === String(workflowExecutionRunId) ? "0" : value)),
      valid.map((value) => (value === "/tmp/workflow-execution.json" ? "relative" : value)),
      [...valid, "--write"],
      [...valid, "--attempt", "3"],
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/release/first-publication/stage/commands/show-cli-first-publication-stage-result-evidence.mjs",
          ...args,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^first_publication_stage_result_arguments_invalid:/u);
    }
  });
});
