import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { verifyCliFirstPublicationWorkflowActivationPostApply } from "../lib/cli-first-publication-workflow-activation-post-apply.mjs";
import { parseFirstPublicationWorkflowActivationPostApplyArguments } from "../lib/first-publication-workflow-activation-post-apply-cli-arguments.mjs";
import { formatFirstPublicationWorkflowActivationPostApplyReport } from "../lib/first-publication-workflow-activation-post-apply-formatter.mjs";
import {
  createAppliedWorkflowActivationFixture,
  readyWorkflowActivationGitHubObservation,
  readyWorkflowActivationNpmObservation,
  workflowActivationRepository,
} from "./fixtures/first-publication-workflow-activation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function verify(fixture, overrides = {}) {
  return verifyCliFirstPublicationWorkflowActivationPostApply(
    {
      repository: workflowActivationRepository,
      receiptPath: fixture.receiptPath,
      online: true,
    },
    {
      paths: fixture.paths,
      transactionRoot: fixture.transactionRoot,
      observeNpm: async () => readyWorkflowActivationNpmObservation(),
      observeGitHub: async () => readyWorkflowActivationGitHubObservation(),
      clock: () => "2026-08-21T10:06:00Z",
      ...overrides,
    },
  );
}

describe("first-publication workflow activation post-apply command", () => {
  it("reads current sources and external controls without changing them", async () => {
    const fixture = await createAppliedWorkflowActivationFixture();
    try {
      const paths = [
        fixture.paths.packageManifestPath,
        fixture.paths.cliPackageManifestPath,
        fixture.paths.workflowPath,
        fixture.receiptPath,
      ];
      const before = await Promise.all(paths.map((path) => readFile(path)));
      const report = await verify(fixture);
      assert.equal(report.status, "verified");
      assert.equal(report.observedAt, "2026-08-21T10:06:00Z");
      assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails when fresh external protection is no longer ready", async () => {
    const fixture = await createAppliedWorkflowActivationFixture();
    try {
      await assert.rejects(
        verify(fixture, {
          observeGitHub: async () =>
            readyWorkflowActivationGitHubObservation({
              preventSelfReview: false,
            }),
        }),
        { code: "first_publication_workflow_activation_post_apply_not_ready" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects source changes during online observation", async () => {
    const fixture = await createAppliedWorkflowActivationFixture();
    try {
      await assert.rejects(
        verify(fixture, {
          observeGitHub: async () => {
            await writeFile(fixture.paths.packageManifestPath, "{}\n");
            return readyWorkflowActivationGitHubObservation();
          },
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("blocks pending transactions before reads and transactions created during observation", async () => {
    const pending = await createAppliedWorkflowActivationFixture();
    try {
      await mkdir(pending.transactionRoot);
      let reads = 0;
      await assert.rejects(
        verify(pending, {
          readSources: async () => {
            reads += 1;
            throw new Error("must not read");
          },
        }),
        { code: "first_publication_workflow_activation_post_apply_transaction_pending" },
      );
      assert.equal(reads, 0);
    } finally {
      await rm(pending.root, { recursive: true, force: true });
    }

    const raced = await createAppliedWorkflowActivationFixture();
    try {
      await assert.rejects(
        verify(raced, {
          observeGitHub: async () => {
            await mkdir(raced.transactionRoot);
            return readyWorkflowActivationGitHubObservation();
          },
        }),
        { code: "first_publication_workflow_activation_post_apply_transaction_pending" },
      );
    } finally {
      await rm(raced.root, { recursive: true, force: true });
    }
  });

  it("uses clear Korean without exposing receipt or report digests", async () => {
    const fixture = await createAppliedWorkflowActivationFixture();
    try {
      const report = await verify(fixture);
      const output = formatFirstPublicationWorkflowActivationPostApplyReport(report);
      assert.match(
        output,
        /current workflow file matches the result recorded in the apply receipt/u,
      );
      assert.match(output, /does not establish that the workflow was deployed or run on GitHub/u);
      assert.equal(output.includes(report.reportDigest), false);
      assert.equal(output.includes(report.receipt.receiptDigest), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects offline, relative, duplicate, write, and unknown arguments before work", () => {
    assert.deepEqual(
      parseFirstPublicationWorkflowActivationPostApplyArguments([
        "--repository",
        workflowActivationRepository,
        "--receipt",
        "/tmp/receipt.json",
        "--online",
        "--json",
      ]),
      {
        repository: workflowActivationRepository,
        receiptPath: "/tmp/receipt.json",
        online: true,
        json: true,
      },
    );
    for (const args of [
      [],
      ["--repository", workflowActivationRepository, "--receipt", "/tmp/r"],
      ["--online", "--repository", workflowActivationRepository, "--receipt", "relative"],
      ["--online", "--online", "--repository", workflowActivationRepository, "--receipt", "/tmp/r"],
      ["--online", "--write", "--repository", workflowActivationRepository, "--receipt", "/tmp/r"],
      ["--unknown"],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/verify-cli-first-publication-workflow-activation-post-apply.mjs", ...args],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(
        result.stderr,
        /^first_publication_workflow_activation_post_apply_arguments_invalid:/u,
      );
    }
  });
});
