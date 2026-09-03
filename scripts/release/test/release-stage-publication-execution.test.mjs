import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createFileReleaseStagePublicationStore } from "../lib/file-release-stage-publication-store.mjs";
import { executeReleaseStagePublication } from "../lib/release-stage-publication-execution.mjs";
import {
  createReleasePublicationArtifact,
  createReleasePublicationAuthorization,
} from "../lib/release-publication-authorization.mjs";

function hex(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function fixture() {
  const tarball = Buffer.from("exact-stage-tarball");
  const artifact = createReleasePublicationArtifact("lervo-cli-0.1.0.tgz", "0.1.0", tarball);
  const authorization = createReleasePublicationAuthorization({
    version: "0.1.0",
    distTag: "latest",
    artifact,
    verification: {
      schemaVersion: 1,
      status: "verified",
      repository: "lervo-dev/lervo",
      workflow: ".github/workflows/cli-release-matrix.yml",
      tag: "v0.1.0",
      sourceDigest: "c".repeat(40),
      subjects: [
        { name: artifact.file, digest: { sha256: artifact.sha256 } },
        { name: "release-artifact-manifest.json", digest: { sha256: hex("manifest") } },
        { name: "release-sbom.cdx.json", digest: { sha256: hex("sbom") } },
      ],
    },
  });
  return { authorization, artifact };
}

function receipt(authorization) {
  return {
    schemaVersion: 1,
    status: "stage_submission_accepted",
    operation: "npm_stage_publish",
    target: structuredClone(authorization.target),
    artifact: structuredClone(authorization.artifact),
    evidence: "npm_cli_exit_zero",
  };
}

function sequenceClock(...values) {
  return () => values.shift();
}

describe("release stage publication execution", () => {
  it("persists an immutable attempt before staging and a bounded success terminal after", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-stage-execution-"));
    try {
      const sourceFixture = fixture();
      const resultDirectory = resolve(root, "result");
      const events = [];
      const terminal = await executeReleaseStagePublication(
        {
          authorization: sourceFixture.authorization,
          releaseDirectory: root,
          tarballPath: resolve(root, sourceFixture.artifact.file),
          assertUnchanged: async () => events.push("snapshot"),
        },
        {
          store: createFileReleaseStagePublicationStore({ rootDirectory: resultDirectory }),
          prepareStage: async () => ({
            stage: async () => {
              events.push("stage");
              assert.equal(events.filter((event) => event === "snapshot").length, 2);
              const attempt = JSON.parse(
                await readFile(resolve(resultDirectory, "attempt.json"), "utf8"),
              );
              assert.equal(attempt.state, "reserved");
              assert.equal(attempt.retry, "forbidden_without_reconciliation");
              return receipt(sourceFixture.authorization);
            },
            dispose: async () => events.push("dispose"),
          }),
          clock: sequenceClock("2026-08-21T05:00:00Z", "2026-08-21T05:01:00Z"),
        },
      );
      assert.equal(terminal.state, "staged");
      assert.equal(terminal.publicAvailability, "not_claimed");
      assert.equal(terminal.review, "required_with_2fa");
      assert.deepEqual(events, ["snapshot", "snapshot", "stage", "snapshot", "dispose"]);
      assert.equal(
        JSON.parse(await readFile(resolve(resultDirectory, "terminal.json"), "utf8")).state,
        "staged",
      );
      assert.equal((await stat(resultDirectory)).mode & 0o777, 0o700);
      assert.equal((await stat(resolve(resultDirectory, "attempt.json"))).mode & 0o777, 0o600);
      assert.equal((await stat(resolve(resultDirectory, "terminal.json"))).mode & 0o777, 0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("closes a started stage call as unknown and forbids blind retry", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-stage-unknown-"));
    try {
      const sourceFixture = fixture();
      const resultDirectory = resolve(root, "result");
      await assert.rejects(
        executeReleaseStagePublication(
          {
            authorization: sourceFixture.authorization,
            releaseDirectory: root,
            tarballPath: resolve(root, sourceFixture.artifact.file),
            assertUnchanged: async () => {},
          },
          {
            store: createFileReleaseStagePublicationStore({ rootDirectory: resultDirectory }),
            prepareStage: async () => ({
              stage: async () => {
                throw new Error("lost response");
              },
              dispose: async () => {},
            }),
            clock: sequenceClock("2026-08-21T05:00:00Z", "2026-08-21T05:01:00Z"),
          },
        ),
        { code: "release_stage_publication_outcome_unknown" },
      );
      const terminal = JSON.parse(await readFile(resolve(resultDirectory, "terminal.json")));
      assert.equal(terminal.state, "stage_outcome_unknown");
      assert.equal(terminal.retry, "forbidden");
      assert.equal(terminal.reconciliation, "authenticated_npm_stage_review_required");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records a source race before the external call as a known abort", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-stage-abort-"));
    try {
      const sourceFixture = fixture();
      const resultDirectory = resolve(root, "result");
      let snapshots = 0;
      let stageCalls = 0;
      await assert.rejects(
        executeReleaseStagePublication(
          {
            authorization: sourceFixture.authorization,
            releaseDirectory: root,
            tarballPath: resolve(root, sourceFixture.artifact.file),
            assertUnchanged: async () => {
              snapshots += 1;
              if (snapshots === 2) throw new Error("source changed");
            },
          },
          {
            store: createFileReleaseStagePublicationStore({ rootDirectory: resultDirectory }),
            prepareStage: async () => ({
              stage: async () => {
                stageCalls += 1;
                return receipt(sourceFixture.authorization);
              },
              dispose: async () => {},
            }),
            clock: sequenceClock("2026-08-21T05:00:00Z", "2026-08-21T05:01:00Z"),
          },
        ),
        /source changed/u,
      );
      assert.equal(stageCalls, 0);
      const terminal = JSON.parse(await readFile(resolve(resultDirectory, "terminal.json")));
      assert.equal(terminal.state, "aborted_before_stage");
      assert.equal(terminal.retry, "new_authorization_required");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects reuse of an existing result directory before another stage call", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-stage-reuse-"));
    try {
      const sourceFixture = fixture();
      const resultDirectory = resolve(root, "result");
      const store = createFileReleaseStagePublicationStore({ rootDirectory: resultDirectory });
      let calls = 0;
      const input = {
        authorization: sourceFixture.authorization,
        releaseDirectory: root,
        tarballPath: resolve(root, sourceFixture.artifact.file),
        assertUnchanged: async () => {},
      };
      const dependencies = () => ({
        store,
        prepareStage: async () => ({
          stage: async () => {
            calls += 1;
            return receipt(sourceFixture.authorization);
          },
          dispose: async () => {},
        }),
        clock: sequenceClock("2026-08-21T05:00:00Z", "2026-08-21T05:01:00Z"),
      });
      await executeReleaseStagePublication(input, dependencies());
      await assert.rejects(executeReleaseStagePublication(input, dependencies()), {
        code: "release_stage_publication_already_attempted",
      });
      assert.equal(calls, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
