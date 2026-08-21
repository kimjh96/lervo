import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  workflowExecutionArtifactName,
  workflowExecutionJobName,
  workflowResultUploadStepName,
  workflowStageStepName,
} from "../lib/first-publication-workflow-execution-contract.mjs";
import { remoteReleaseWorkflowPath } from
  "../lib/first-publication-workflow-remote-source-contract.mjs";
import { observeGitHubWorkflowExecution } from
  "../lib/github-workflow-execution-observer.mjs";

const repository = "lervo-dev/lervo";
const sourceCommit = "c".repeat(40);
const releaseTag = "v0.1.0";
const runId = 12_345_678;
const attempt = 2;

function rawRun(overrides = {}) {
  return {
    id: runId,
    run_attempt: attempt,
    run_number: 41,
    workflow_id: 77,
    path: `${remoteReleaseWorkflowPath}@refs/tags/${releaseTag}`,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    head_branch: releaseTag,
    head_sha: sourceCommit,
    created_at: "2026-08-21T10:09:00Z",
    run_started_at: "2026-08-21T10:09:03Z",
    updated_at: "2026-08-21T10:12:00Z",
    actor: { login: "private-actor" },
    triggering_actor: { login: "private-trigger" },
    ...overrides,
  };
}

function rawJob(overrides = {}) {
  return {
    id: 88,
    run_id: runId,
    name: workflowExecutionJobName,
    head_sha: sourceCommit,
    status: "completed",
    conclusion: "success",
    started_at: "2026-08-21T10:10:00Z",
    completed_at: "2026-08-21T10:11:50Z",
    runner_name: "private-runner",
    labels: ["private-label"],
    steps: [
      {
        name: workflowStageStepName,
        number: 6,
        status: "completed",
        conclusion: "success",
        started_at: "2026-08-21T10:10:30Z",
        completed_at: "2026-08-21T10:11:15Z",
      },
      {
        name: workflowResultUploadStepName,
        number: 7,
        status: "completed",
        conclusion: "success",
        started_at: "2026-08-21T10:11:16Z",
        completed_at: "2026-08-21T10:11:45Z",
      },
    ],
    ...overrides,
  };
}

function rawArtifact(overrides = {}) {
  return {
    id: 99,
    name: workflowExecutionArtifactName(releaseTag, attempt),
    size_in_bytes: 4_096,
    digest: `sha256:${"a".repeat(64)}`,
    expired: false,
    created_at: "2026-08-21T10:11:40Z",
    expires_at: "2026-09-20T10:11:40Z",
    workflow_run: { id: runId, head_sha: sourceCommit },
    ...overrides,
  };
}

function route(overrides = {}) {
  let runReads = 0;
  const calls = [];
  const execute = async (command, args, options) => {
    const path = args.at(-1);
    calls.push({ command, args, options, path });
    const encodedWorkflow = encodeURIComponent(remoteReleaseWorkflowPath);
    if (path === `repos/${repository}/actions/workflows/${encodedWorkflow}`) {
      return { stdout: JSON.stringify(overrides.workflow ?? {
        id: 77,
        path: remoteReleaseWorkflowPath,
        state: "active",
      }) };
    }
    if (path === `repos/${repository}/actions/runs/${runId}`) {
      runReads += 1;
      return { stdout: JSON.stringify(
        overrides.run?.(runReads) ?? rawRun(),
      ) };
    }
    if (path === `repos/${repository}/actions/runs/${runId}/attempts/${attempt}`) {
      return { stdout: JSON.stringify(overrides.attempt ?? rawRun()) };
    }
    if (path.endsWith(`/attempts/${attempt}/jobs?per_page=100&page=1`)) {
      return { stdout: JSON.stringify(overrides.jobs ?? {
        total_count: 1,
        jobs: [rawJob()],
      }) };
    }
    if (path.includes(`/actions/runs/${runId}/artifacts?`)) {
      return { stdout: JSON.stringify(overrides.artifacts ?? {
        total_count: 1,
        artifacts: [rawArtifact()],
      }) };
    }
    throw new Error(`unexpected route: ${path}`);
  };
  return { execute, calls };
}

describe("GitHub workflow execution observer", () => {
  it("binds one exact terminal attempt, job, steps, and artifact with GET-only calls", async () => {
    const fixture = route();
    const observation = await observeGitHubWorkflowExecution({
      repository,
      sourceCommit,
      releaseTag,
      runId,
      attempt,
      execute: fixture.execute,
      environment: { GH_TOKEN: "test-token" },
    });
    assert.equal(observation.state, "observed");
    assert.equal(observation.run.attempt, attempt);
    assert.equal(observation.job.stage.name, workflowStageStepName);
    assert.equal(observation.artifact.name,
      workflowExecutionArtifactName(releaseTag, attempt));
    assert.equal(observation.runStability, "rechecked_unchanged");
    assert.equal(fixture.calls.length, 6);
    assert.equal(fixture.calls.every(({ command, args }) =>
      command === "gh" && args[0] === "api" && args[2] === "GET"), true);
    assert.equal(fixture.calls[0].options.env.GH_TOKEN, "test-token");
    const serialized = JSON.stringify(observation);
    assert.equal(serialized.includes("private-actor"), false);
    assert.equal(serialized.includes("private-trigger"), false);
    assert.equal(serialized.includes("private-runner"), false);
    assert.equal(serialized.includes("private-label"), false);
  });

  it("rejects a historical attempt and a rerun that starts during observation", async () => {
    const historical = route({ run: () => rawRun({ run_attempt: 3 }) });
    assert.deepEqual(await observeGitHubWorkflowExecution({
      repository, sourceCommit, releaseTag, runId, attempt, execute: historical.execute,
    }), {
      schemaVersion: 1,
      source: "github_actions_workflow_execution",
      state: "unavailable",
      reason: "run_or_attempt_mismatch",
    });

    const moving = route({
      run: (read) => rawRun(read === 1 ? {} : {
        run_attempt: 3,
        status: "in_progress",
        conclusion: null,
      }),
    });
    assert.equal((await observeGitHubWorkflowExecution({
      repository, sourceCommit, releaseTag, runId, attempt, execute: moving.execute,
    })).reason, "run_changed");
  });

  it("fails closed for failed steps, ambiguous artifacts, and truncated result sets", async () => {
    const failedStep = route({
      jobs: {
        total_count: 1,
        jobs: [rawJob({
          steps: [
            ...rawJob().steps.slice(0, 1),
            { ...rawJob().steps[1], conclusion: "failure" },
          ],
        })],
      },
    });
    const failedObservation = await observeGitHubWorkflowExecution({
      repository, sourceCommit, releaseTag, runId, attempt, execute: failedStep.execute,
    });
    assert.equal(failedObservation.state, "observed");
    assert.equal(failedObservation.job.resultUpload.conclusion, "failure");

    const ambiguous = route({
      artifacts: { total_count: 2, artifacts: [rawArtifact(), rawArtifact({ id: 100 })] },
    });
    assert.equal((await observeGitHubWorkflowExecution({
      repository, sourceCommit, releaseTag, runId, attempt, execute: ambiguous.execute,
    })).reason, "response_invalid");

    const tooMany = route({ jobs: { total_count: 101, jobs: [rawJob()] } });
    assert.equal((await observeGitHubWorkflowExecution({
      repository, sourceCommit, releaseTag, runId, attempt, execute: tooMany.execute,
    })).reason, "result_set_invalid");
  });

  it("rejects mismatched workflow/source and hides remote failures", async () => {
    const wrongWorkflow = route({ workflow: {
      id: 78,
      path: remoteReleaseWorkflowPath,
      state: "active",
    } });
    assert.equal((await observeGitHubWorkflowExecution({
      repository, sourceCommit, releaseTag, runId, attempt, execute: wrongWorkflow.execute,
    })).reason, "run_or_attempt_mismatch");

    const failed = await observeGitHubWorkflowExecution({
      repository,
      sourceCommit,
      releaseTag,
      runId,
      attempt,
      execute: async () => { throw new Error("credential and raw response"); },
    });
    assert.equal(failed.reason, "authentication_or_execution_unavailable");
    assert.equal(JSON.stringify(failed).includes("credential"), false);

    let calls = 0;
    await assert.rejects(observeGitHubWorkflowExecution({
      repository,
      sourceCommit,
      releaseTag: "latest",
      runId,
      attempt,
      execute: async () => { calls += 1; },
    }), TypeError);
    assert.equal(calls, 0);
  });
});
