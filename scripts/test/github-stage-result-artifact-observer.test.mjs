import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { observeGitHubStageResultArtifact } from "../lib/github-stage-result-artifact-observer.mjs";
import { sha256 } from "../lib/release-artifact-manifest.mjs";
import { createStageResultArchive } from "./fixtures/first-publication-stage-result.mjs";

const repository = "lervo-dev/lervo";
const sourceCommit = "c".repeat(40);
const runId = 12_345_678;
const stage = createStageResultArchive();
const artifact = {
  id: 99,
  name: "lervo-cli-stage-v0.1.0-2",
  sizeInBytes: stage.archiveContents.length,
  digest: sha256(stage.archiveContents),
  expired: false,
  createdAt: "2026-08-21T10:11:40Z",
  expiresAt: "2026-09-20T10:11:40Z",
};

function rawArtifact(overrides = {}) {
  return {
    id: artifact.id,
    name: artifact.name,
    size_in_bytes: artifact.sizeInBytes,
    digest: artifact.digest,
    expired: false,
    created_at: artifact.createdAt,
    expires_at: artifact.expiresAt,
    workflow_run: { id: runId, head_sha: sourceCommit },
    actor: { login: "private-actor" },
    ...overrides,
  };
}

function route(overrides = {}) {
  let metadataReads = 0;
  const calls = [];
  const execute = async (command, args, options) => {
    const path = args.at(-1);
    calls.push({ command, args, options, path });
    if (path.endsWith(`actions/artifacts/${artifact.id}`)) {
      metadataReads += 1;
      return { stdout: JSON.stringify(overrides.metadata?.(metadataReads) ?? rawArtifact()) };
    }
    if (path.endsWith(`actions/artifacts/${artifact.id}/zip`)) {
      return { stdout: overrides.archive ?? stage.archiveContents };
    }
    throw new Error(`unexpected route: ${path}`);
  };
  return { execute, calls };
}

describe("GitHub stage result artifact observer", () => {
  it("downloads exact bounded bytes between two stable metadata reads", async () => {
    const fixture = route();
    const observation = await observeGitHubStageResultArtifact({
      repository,
      sourceCommit,
      runId,
      artifact,
      execute: fixture.execute,
      environment: { GH_TOKEN: "test-token" },
    });
    assert.equal(observation.state, "observed");
    assert.deepEqual(observation.archive.contents, stage.archiveContents);
    assert.equal(observation.metadataStability, "rechecked_unchanged");
    assert.equal(fixture.calls.length, 3);
    assert.equal(
      fixture.calls.every(
        ({ command, args }) => command === "gh" && args[0] === "api" && args[2] === "GET",
      ),
      true,
    );
    assert.equal(fixture.calls[1].options.encoding, null);
    assert.equal(JSON.stringify(observation).includes("private-actor"), false);
  });

  it("rejects mismatched bytes and metadata changes", async () => {
    const wrongBytes = route({ archive: Buffer.from("not the artifact") });
    assert.equal(
      (
        await observeGitHubStageResultArtifact({
          repository,
          sourceCommit,
          runId,
          artifact,
          execute: wrongBytes.execute,
        })
      ).reason,
      "archive_invalid",
    );

    const changed = route({
      metadata: (read) => rawArtifact(read === 1 ? {} : { expires_at: "2026-09-21T00:00:00Z" }),
    });
    assert.equal(
      (
        await observeGitHubStageResultArtifact({
          repository,
          sourceCommit,
          runId,
          artifact,
          execute: changed.execute,
        })
      ).reason,
      "artifact_changed",
    );
  });

  it("bounds size before download and hides remote failures", async () => {
    let calls = 0;
    const oversized = await observeGitHubStageResultArtifact({
      repository,
      sourceCommit,
      runId,
      artifact: { ...artifact, sizeInBytes: 1024 * 1024 + 1 },
      execute: async () => {
        calls += 1;
      },
    });
    assert.equal(oversized.reason, "archive_size_invalid");
    assert.equal(calls, 0);

    const failed = await observeGitHubStageResultArtifact({
      repository,
      sourceCommit,
      runId,
      artifact,
      execute: async () => {
        throw new Error("credential and response");
      },
    });
    assert.equal(failed.reason, "authentication_or_artifact_unavailable");
    assert.equal(JSON.stringify(failed).includes("credential"), false);
  });
});
