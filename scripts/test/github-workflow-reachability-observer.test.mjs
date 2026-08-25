import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { observeGitHubWorkflowReachability } from "../lib/github-workflow-reachability-observer.mjs";
import { remoteCliPackagePath } from "../lib/first-publication-workflow-reachability-contract.mjs";
import { sha256 } from "../lib/release-artifact-manifest.mjs";

const repository = "lervo-dev/lervo";
const sourceCommit = "c".repeat(40);
const defaultHead = "e".repeat(40);
const releaseTag = "v0.1.0";
const sourcePackage = Buffer.from('{"name":"@lervo/cli"}\n');

function route(overrides = {}) {
  let repositoryReads = 0;
  let branchReads = 0;
  let tagReads = 0;
  const calls = [];
  const execute = async (command, args, options) => {
    const path = args.at(-1);
    calls.push({ command, args, options, path });
    if (path === `repos/${repository}`) {
      repositoryReads += 1;
      return {
        stdout: JSON.stringify(
          overrides.repository?.(repositoryReads) ?? {
            default_branch: "main",
          },
        ),
      };
    }
    if (path === `repos/${repository}/contents/${remoteCliPackagePath}?ref=${sourceCommit}`) {
      return {
        stdout: JSON.stringify(
          overrides.sourcePackage ?? {
            type: "file",
            path: remoteCliPackagePath,
            encoding: "base64",
            size: sourcePackage.length,
            sha: "f".repeat(40),
            content: sourcePackage.toString("base64"),
          },
        ),
      };
    }
    if (path === `repos/${repository}/git/ref/heads/main`) {
      branchReads += 1;
      return {
        stdout: JSON.stringify(
          overrides.branch?.(branchReads) ?? {
            ref: "refs/heads/main",
            object: { type: "commit", sha: defaultHead },
          },
        ),
      };
    }
    if (path === `repos/${repository}/git/ref/tags/${releaseTag}`) {
      tagReads += 1;
      return {
        stdout: JSON.stringify(
          overrides.tag?.(tagReads) ?? {
            ref: `refs/tags/${releaseTag}`,
            object: { type: "commit", sha: sourceCommit },
          },
        ),
      };
    }
    if (path.startsWith(`repos/${repository}/git/tags/`)) {
      const sha = path.split("/").at(-1);
      return {
        stdout: JSON.stringify(
          overrides.tagObject?.(sha) ?? {
            sha,
            object: { type: "commit", sha: sourceCommit },
          },
        ),
      };
    }
    if (path.startsWith(`repos/${repository}/compare/`)) {
      return {
        stdout: JSON.stringify(
          overrides.comparison ?? {
            status: "ahead",
            ahead_by: 2,
            behind_by: 0,
            base_commit: { sha: sourceCommit },
            merge_base_commit: { sha: sourceCommit },
          },
        ),
      };
    }
    throw new Error(`unexpected route: ${path}`);
  };
  return { execute, calls };
}

describe("GitHub workflow reachability observer", () => {
  it("binds a stable default branch and lightweight tag with GET-only calls", async () => {
    const fixture = route();
    const observation = await observeGitHubWorkflowReachability({
      repository,
      sourceCommit,
      releaseTag,
      execute: fixture.execute,
      environment: { GH_TOKEN: "test-token" },
    });
    assert.deepEqual(observation, {
      schemaVersion: 1,
      source: "github_repository_reachability",
      state: "observed",
      repository,
      sourceCommit,
      defaultBranch: {
        name: "main",
        headCommit: defaultHead,
        relation: "source_commit_ancestor_or_equal",
        commitsAhead: 2,
      },
      releaseTag: {
        name: releaseTag,
        kind: "lightweight",
        annotatedDepth: 0,
        commit: sourceCommit,
      },
      sourcePackage: {
        path: remoteCliPackagePath,
        blobSha: "f".repeat(40),
        byteCount: sourcePackage.length,
        sha256: sha256(sourcePackage),
        contents: sourcePackage,
      },
      referenceStability: "rechecked_unchanged",
    });
    assert.equal(fixture.calls.length, 8);
    assert.equal(
      fixture.calls.every(({ command }) => command === "gh"),
      true,
    );
    assert.equal(
      fixture.calls.every(({ args }) => args[0] === "api" && args[2] === "GET"),
      true,
    );
    assert.equal(
      fixture.calls.some(
        ({ path }) =>
          path === `repos/${repository}/compare/${sourceCommit}...${defaultHead}?per_page=1&page=1`,
      ),
      true,
    );
    assert.equal(fixture.calls[0].options.env.GH_TOKEN, "test-token");
  });

  it("dereferences bounded nested annotated tags without retaining tag metadata", async () => {
    const first = "d".repeat(40);
    const second = "f".repeat(40);
    const fixture = route({
      tag: () => ({
        ref: `refs/tags/${releaseTag}`,
        object: { type: "tag", sha: first },
      }),
      tagObject: (sha) =>
        sha === first
          ? {
              sha,
              tag: releaseTag,
              message: "private note",
              tagger: { name: "actor" },
              object: { type: "tag", sha: second },
            }
          : { sha, object: { type: "commit", sha: sourceCommit } },
    });
    const observation = await observeGitHubWorkflowReachability({
      repository,
      sourceCommit,
      releaseTag,
      execute: fixture.execute,
    });
    assert.deepEqual(observation.releaseTag, {
      name: releaseTag,
      kind: "annotated",
      annotatedDepth: 2,
      commit: sourceCommit,
    });
    assert.equal(JSON.stringify(observation).includes("private note"), false);
    assert.equal(JSON.stringify(observation).includes("actor"), false);
  });

  it("accepts the source commit when it is the default branch head", async () => {
    const fixture = route({
      branch: () => ({
        ref: "refs/heads/main",
        object: { type: "commit", sha: sourceCommit },
      }),
      comparison: {
        status: "identical",
        ahead_by: 0,
        behind_by: 0,
        base_commit: { sha: sourceCommit },
        merge_base_commit: { sha: sourceCommit },
      },
    });
    const observation = await observeGitHubWorkflowReachability({
      repository,
      sourceCommit,
      releaseTag,
      execute: fixture.execute,
    });
    assert.equal(observation.defaultBranch.headCommit, sourceCommit);
    assert.equal(observation.defaultBranch.relation, "source_commit_ancestor_or_equal");
    assert.equal(observation.defaultBranch.commitsAhead, 0);
  });

  it("reports non-ancestor and wrong-tag commits as observations for policy", async () => {
    const otherCommit = "a".repeat(40);
    const fixture = route({
      comparison: {
        status: "diverged",
        ahead_by: 2,
        behind_by: 1,
        base_commit: { sha: sourceCommit },
        merge_base_commit: { sha: "b".repeat(40) },
      },
      tag: () => ({
        ref: `refs/tags/${releaseTag}`,
        object: { type: "commit", sha: otherCommit },
      }),
    });
    const observation = await observeGitHubWorkflowReachability({
      repository,
      sourceCommit,
      releaseTag,
      execute: fixture.execute,
    });
    assert.equal(observation.defaultBranch.relation, "source_commit_not_ancestor");
    assert.equal(observation.releaseTag.commit, otherCommit);
  });

  it("fails closed when the default branch or tag ref moves during observation", async () => {
    for (const overrides of [
      {
        branch: (read) => ({
          ref: "refs/heads/main",
          object: { type: "commit", sha: read === 1 ? defaultHead : "a".repeat(40) },
        }),
      },
      {
        tag: (read) => ({
          ref: `refs/tags/${releaseTag}`,
          object: { type: "commit", sha: read === 1 ? sourceCommit : "a".repeat(40) },
        }),
      },
      { repository: (read) => ({ default_branch: read === 1 ? "main" : "trunk" }) },
    ]) {
      const fixture = route(overrides);
      const observation = await observeGitHubWorkflowReachability({
        repository,
        sourceCommit,
        releaseTag,
        execute: fixture.execute,
      });
      assert.equal(observation.state, "unavailable");
      assert.equal(observation.reason, "references_changed");
    }
  });

  it("bounds invalid responses, deep tag chains, failures, and invalid input", async () => {
    const invalid = route({ repository: () => ({ default_branch: "../unsafe" }) });
    assert.equal(
      (
        await observeGitHubWorkflowReachability({
          repository,
          sourceCommit,
          releaseTag,
          execute: invalid.execute,
        })
      ).reason,
      "response_invalid",
    );

    const tagShas = ["1", "2", "3", "4", "5", "6"].map((value) => value.repeat(40));
    const deep = route({
      tag: () => ({
        ref: `refs/tags/${releaseTag}`,
        object: { type: "tag", sha: tagShas[0] },
      }),
      tagObject: (sha) => ({
        sha,
        object: { type: "tag", sha: tagShas[tagShas.indexOf(sha) + 1] },
      }),
    });
    assert.equal(
      (
        await observeGitHubWorkflowReachability({
          repository,
          sourceCommit,
          releaseTag,
          execute: deep.execute,
        })
      ).reason,
      "response_invalid",
    );

    const failed = await observeGitHubWorkflowReachability({
      repository,
      sourceCommit,
      releaseTag,
      execute: async () => {
        throw new Error("credential and raw response");
      },
    });
    assert.equal(failed.reason, "authentication_or_references_unavailable");

    let calls = 0;
    await assert.rejects(
      observeGitHubWorkflowReachability({
        repository,
        sourceCommit: "C".repeat(40),
        releaseTag,
        execute: async () => {
          calls += 1;
        },
      }),
      TypeError,
    );
    assert.equal(calls, 0);
  });
});
