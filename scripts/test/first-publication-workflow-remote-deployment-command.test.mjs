import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createCliFirstPublicationWorkflowRemoteDeploymentEvidence } from "../lib/cli-first-publication-workflow-remote-deployment.mjs";
import { parseFirstPublicationWorkflowRemoteDeploymentArguments } from "../lib/first-publication-workflow-remote-deployment-cli-arguments.mjs";
import { formatFirstPublicationWorkflowRemoteDeploymentEvidence } from "../lib/first-publication-workflow-remote-deployment-formatter.mjs";
import {
  createWorkflowRemoteDeploymentFixture,
  matchingRemoteWorkflowObservation,
  workflowRemoteSourceCommit,
} from "./fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from "./fixtures/first-publication-workflow-activation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function createEvidence(fixture, overrides = {}) {
  return createCliFirstPublicationWorkflowRemoteDeploymentEvidence(
    {
      repository: workflowActivationRepository,
      sourceCommit: workflowRemoteSourceCommit,
      postApplyReportPath: fixture.postApplyReportPath,
      online: true,
    },
    {
      paths: { workflowPath: fixture.paths.workflowPath },
      transactionRoot: fixture.transactionRoot,
      observeRemote: async () => matchingRemoteWorkflowObservation(fixture),
      clock: () => "2026-08-21T10:07:00Z",
      ...overrides,
    },
  );
}

describe("first-publication workflow remote deployment command", () => {
  it("reads local and remote evidence without changing local sources", async () => {
    const fixture = await createWorkflowRemoteDeploymentFixture();
    try {
      const paths = [fixture.paths.workflowPath, fixture.postApplyReportPath];
      const before = await Promise.all(paths.map((path) => readFile(path)));
      const report = await createEvidence(fixture);
      assert.equal(report.status, "evidence_bound");
      assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects source changes during remote observation", async () => {
    const fixture = await createWorkflowRemoteDeploymentFixture();
    try {
      await assert.rejects(
        createEvidence(fixture, {
          observeRemote: async () => {
            const observation = await matchingRemoteWorkflowObservation(fixture);
            await writeFile(fixture.postApplyReportPath, "{}\n");
            return observation;
          },
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("blocks transactions before reads and transactions created during observation", async () => {
    const pending = await createWorkflowRemoteDeploymentFixture();
    try {
      await mkdir(pending.transactionRoot);
      let reads = 0;
      await assert.rejects(
        createEvidence(pending, {
          readSources: async () => {
            reads += 1;
            throw new Error("must not read");
          },
        }),
        { code: "first_publication_workflow_remote_deployment_transaction_pending" },
      );
      assert.equal(reads, 0);
    } finally {
      await rm(pending.root, { recursive: true, force: true });
    }

    const raced = await createWorkflowRemoteDeploymentFixture();
    try {
      await assert.rejects(
        createEvidence(raced, {
          observeRemote: async () => {
            const observation = await matchingRemoteWorkflowObservation(raced);
            await mkdir(raced.transactionRoot);
            return observation;
          },
        }),
        { code: "first_publication_workflow_remote_deployment_transaction_pending" },
      );
    } finally {
      await rm(raced.root, { recursive: true, force: true });
    }
  });

  it("fails closed for unavailable or mismatched remote source", async () => {
    const fixture = await createWorkflowRemoteDeploymentFixture();
    try {
      await assert.rejects(
        createEvidence(fixture, {
          observeRemote: async () => ({
            schemaVersion: 1,
            source: "github_repository_workflow",
            state: "unavailable",
            reason: "authentication_or_workflow_unavailable",
          }),
        }),
        { code: "first_publication_workflow_remote_deployment_not_ready" },
      );
      await assert.rejects(
        createEvidence(fixture, {
          observeRemote: async () =>
            matchingRemoteWorkflowObservation(fixture, {
              contents: Buffer.from("name: other\n"),
              byteCount: 12,
            }),
        }),
        { code: "first_publication_workflow_remote_deployment_bytes_mismatch" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("uses clear Korean without exposing evidence digests", async () => {
    const fixture = await createWorkflowRemoteDeploymentFixture();
    try {
      const report = await createEvidence(fixture);
      const output = formatFirstPublicationWorkflowRemoteDeploymentEvidence(report);
      assert.match(output, /specified GitHub commit contains a file identical/u);
      assert.match(
        output,
        /does not establish that the commit is contained in the default branch or a release tag/u,
      );
      assert.match(output, /Workflow execution, npm stage acceptance, 2FA approval/u);
      assert.equal(output.includes(report.evidenceDigest), false);
      assert.equal(output.includes(report.local.postApplyReportDigest), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects offline, relative, short, duplicate, write, and unknown arguments", () => {
    const valid = [
      "--repository",
      workflowActivationRepository,
      "--source-commit",
      workflowRemoteSourceCommit,
      "--post-apply-report",
      "/tmp/post-apply.json",
      "--online",
      "--json",
    ];
    assert.deepEqual(parseFirstPublicationWorkflowRemoteDeploymentArguments(valid), {
      repository: workflowActivationRepository,
      sourceCommit: workflowRemoteSourceCommit,
      postApplyReportPath: "/tmp/post-apply.json",
      online: true,
      json: true,
    });
    for (const args of [
      [],
      valid.filter((arg) => arg !== "--online"),
      [
        "--online",
        "--repository",
        workflowActivationRepository,
        "--source-commit",
        "c".repeat(39),
        "--post-apply-report",
        "/tmp/r",
      ],
      [
        "--online",
        "--repository",
        workflowActivationRepository,
        "--source-commit",
        workflowRemoteSourceCommit,
        "--post-apply-report",
        "relative",
      ],
      [...valid, "--online"],
      [...valid, "--write"],
      ["--unknown"],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/show-cli-first-publication-workflow-remote-deployment-evidence.mjs", ...args],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(
        result.stderr,
        /^first_publication_workflow_remote_deployment_arguments_invalid:/u,
      );
    }
  });
});
