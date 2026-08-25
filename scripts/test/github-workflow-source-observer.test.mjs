import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  maximumRemoteWorkflowBytes,
  observeGitHubWorkflowSource,
  remoteReleaseWorkflowPath,
} from "../lib/github-workflow-source-observer.mjs";
import { sha256 } from "../lib/release-artifact-manifest.mjs";

const repository = "lervo-dev/lervo";
const sourceCommit = "c".repeat(40);
const workflow = Buffer.from("name: release\n");

function response(overrides = {}) {
  return {
    type: "file",
    path: remoteReleaseWorkflowPath,
    encoding: "base64",
    size: workflow.length,
    sha: "d".repeat(40),
    content: workflow.toString("base64"),
    ...overrides,
  };
}

describe("GitHub workflow source observer", () => {
  it("reads only the exact workflow at the exact commit", async () => {
    const calls = [];
    const environment = { GH_TOKEN: "test-token" };
    const observation = await observeGitHubWorkflowSource({
      repository,
      sourceCommit,
      environment,
      execute: async (command, args, options) => {
        calls.push({ command, args, options });
        return { stdout: JSON.stringify(response()), stderr: "" };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "gh");
    assert.deepEqual(calls[0].args, [
      "api",
      "--method",
      "GET",
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      "X-GitHub-Api-Version: 2026-03-10",
      `repos/${repository}/contents/${remoteReleaseWorkflowPath}?ref=${sourceCommit}`,
    ]);
    assert.equal(calls[0].options.env.GH_PROMPT_DISABLED, "1");
    assert.equal(calls[0].options.env.GH_TOKEN, "test-token");
    assert.deepEqual(observation, {
      schemaVersion: 1,
      source: "github_repository_workflow",
      state: "observed",
      repository,
      sourceCommit,
      path: remoteReleaseWorkflowPath,
      blobSha: "d".repeat(40),
      byteCount: workflow.length,
      sha256: sha256(workflow),
      contents: workflow,
    });
  });

  it("bounds malformed, oversized, and wrong-path responses", async () => {
    const cases = [
      response({ content: "not base64!" }),
      response({ size: maximumRemoteWorkflowBytes + 1 }),
      response({ path: ".github/workflows/other.yml" }),
    ];
    for (const value of cases) {
      const observation = await observeGitHubWorkflowSource({
        repository,
        sourceCommit,
        execute: async () => ({ stdout: JSON.stringify(value), stderr: "" }),
      });
      assert.deepEqual(observation, {
        schemaVersion: 1,
        source: "github_repository_workflow",
        state: "unavailable",
        reason: "response_invalid",
      });
    }
  });

  it("does not expose command failures and validates the commit before execution", async () => {
    const unavailable = await observeGitHubWorkflowSource({
      repository,
      sourceCommit,
      execute: async () => {
        throw new Error("credential and private response");
      },
    });
    assert.equal(unavailable.reason, "authentication_or_workflow_unavailable");

    let calls = 0;
    await assert.rejects(
      observeGitHubWorkflowSource({
        repository,
        sourceCommit: "C".repeat(40),
        execute: async () => {
          calls += 1;
        },
      }),
      TypeError,
    );
    assert.equal(calls, 0);
  });
});
