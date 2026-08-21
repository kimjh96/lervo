import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import {
  applyCliFirstPublicationWorkflowActivation,
  recoverCliFirstPublicationWorkflowActivation,
} from "../lib/cli-first-publication-workflow-activation-apply.mjs";
import { authorizeCliFirstPublicationWorkflowActivation } from
  "../lib/cli-first-publication-workflow-activation-permit.mjs";
import {
  createWorkflowActivationFixture,
  readyWorkflowActivationGitHubObservation,
  readyWorkflowActivationNpmObservation,
  workflowActivationRepository,
} from "./fixtures/first-publication-workflow-activation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function sequence(...values) {
  return () => values.shift();
}

async function prepare() {
  const fixture = await createWorkflowActivationFixture();
  await authorizeCliFirstPublicationWorkflowActivation({
    repository: workflowActivationRepository,
    decisionPath: fixture.decisionPath,
    outputPath: fixture.permitPath,
    online: true,
  }, {
    paths: fixture.paths,
    observeNpm: async () => readyWorkflowActivationNpmObservation(),
    observeGitHub: async () => readyWorkflowActivationGitHubObservation(),
    clock: sequence("2026-08-21T10:01:00Z", "2026-08-21T10:02:00Z"),
  });
  return {
    ...fixture,
    transactionRoot: resolve(fixture.root, ".github/.workflow-activation-transaction"),
  };
}

async function apply(fixture, overrides = {}) {
  return applyCliFirstPublicationWorkflowActivation({
    repository: workflowActivationRepository,
    decisionPath: fixture.decisionPath,
    permitPath: fixture.permitPath,
    online: true,
  }, {
    paths: fixture.paths,
    transactionRoot: fixture.transactionRoot,
    observeNpm: async () => readyWorkflowActivationNpmObservation(),
    observeGitHub: async () => readyWorkflowActivationGitHubObservation(),
    clock: sequence(
      "2026-08-21T10:03:00Z",
      "2026-08-21T10:04:00Z",
      "2026-08-21T10:05:00Z",
    ),
    ...overrides,
  });
}

describe("first-publication workflow activation apply", () => {
  it("rechecks controls and replaces only the exact workflow while preserving mode", async () => {
    const fixture = await prepare();
    try {
      const rootPackageBefore = await readFile(fixture.paths.packageManifestPath);
      const cliPackageBefore = await readFile(fixture.paths.cliPackageManifestPath);
      const receipt = await apply(fixture);
      assert.equal(receipt.status, "applied");
      assert.equal(receipt.activation, "stage_only_workflow_active");
      assert.equal(receipt.publication, "not_attempted");
      assert.equal(receipt.controlsRecheckedAt, "2026-08-21T10:04:00Z");
      assert.deepEqual(
        await readFile(fixture.paths.workflowPath),
        fixture.candidateResult.outputBytes,
      );
      assert.equal((await stat(fixture.paths.workflowPath)).mode & 0o777, 0o640);
      assert.deepEqual(await readFile(fixture.paths.packageManifestPath), rootPackageBefore);
      assert.deepEqual(await readFile(fixture.paths.cliPackageManifestPath), cliPackageBefore);
      await assert.rejects(access(fixture.transactionRoot));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("refuses changed external controls before the first workflow write", async () => {
    const fixture = await prepare();
    try {
      await assert.rejects(apply(fixture, {
        observeGitHub: async () => readyWorkflowActivationGitHubObservation({
          preventSelfReview: false,
        }),
      }), { code: "first_publication_workflow_activation_controls_not_ready" });
      assert.deepEqual(await readFile(fixture.paths.workflowPath), fixture.workflowContents);
      await assert.rejects(access(fixture.transactionRoot));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rechecks every local source after online observations and before transaction creation", async () => {
    const fixture = await prepare();
    try {
      await assert.rejects(apply(fixture, {
        observeGitHub: async () => {
          await writeFile(fixture.paths.packageManifestPath, "{}\n");
          return readyWorkflowActivationGitHubObservation();
        },
      }), { code: "release_attestation_release_set_changed" });
      assert.deepEqual(await readFile(fixture.paths.workflowPath), fixture.workflowContents);
      await assert.rejects(access(fixture.transactionRoot));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rolls back a synchronous failure after moving the original", async () => {
    const fixture = await prepare();
    try {
      await assert.rejects(apply(fixture, {
        failureInjector: async (checkpoint) => {
          if (checkpoint === "original_moved") throw new Error("disk failure");
        },
      }), { code: "first_publication_workflow_activation_apply_failed" });
      assert.deepEqual(await readFile(fixture.paths.workflowPath), fixture.workflowContents);
      await assert.rejects(access(fixture.transactionRoot));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("leaves every interrupted pre-commit phase for explicit rollback recovery", async () => {
    for (const interruptedAt of ["staged", "original_moved"]) {
      const fixture = await prepare();
      try {
        await assert.rejects(apply(fixture, {
          ownerPid: 999999,
          failureInjector: async (checkpoint) =>
            checkpoint === interruptedAt ? "interrupt" : undefined,
        }), { code: "first_publication_workflow_activation_recovery_required" });
        assert.equal((await stat(fixture.transactionRoot)).isDirectory(), true);
        const recovered = await recoverCliFirstPublicationWorkflowActivation({
          paths: fixture.paths,
          transactionRoot: fixture.transactionRoot,
        });
        assert.deepEqual(recovered, { status: "rolled_back" });
        assert.deepEqual(await readFile(fixture.paths.workflowPath), fixture.workflowContents);
        await assert.rejects(access(fixture.transactionRoot));
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    }
  });

  it("keeps a committed workflow and only cleans its interrupted journal", async () => {
    const fixture = await prepare();
    try {
      await assert.rejects(apply(fixture, {
        ownerPid: 999999,
        failureInjector: async (checkpoint) =>
          checkpoint === "committed" ? "interrupt" : undefined,
      }), { code: "first_publication_workflow_activation_recovery_required" });
      assert.deepEqual(await readFile(fixture.paths.workflowPath), fixture.candidateResult.outputBytes);
      const recovered = await recoverCliFirstPublicationWorkflowActivation({
        paths: fixture.paths,
        transactionRoot: fixture.transactionRoot,
      });
      assert.deepEqual(recovered, { status: "committed_cleanup_completed" });
      assert.deepEqual(await readFile(fixture.paths.workflowPath), fixture.candidateResult.outputBytes);
      await assert.rejects(access(fixture.transactionRoot));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails closed when an interrupted recovery journal is not the exact schema", async () => {
    const fixture = await prepare();
    try {
      await assert.rejects(apply(fixture, {
        ownerPid: 999999,
        failureInjector: async (checkpoint) =>
          checkpoint === "staged" ? "interrupt" : undefined,
      }), { code: "first_publication_workflow_activation_recovery_required" });
      const journalPath = resolve(fixture.transactionRoot, "journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      journal.unreviewedAuthority = true;
      await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
      await assert.rejects(recoverCliFirstPublicationWorkflowActivation({
        paths: fixture.paths,
        transactionRoot: fixture.transactionRoot,
      }), { code: "first_publication_workflow_activation_journal_invalid" });
      assert.deepEqual(await readFile(fixture.paths.workflowPath), fixture.workflowContents);
      assert.equal((await stat(fixture.transactionRoot)).isDirectory(), true);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("requires explicit online write mode and keeps recovery arguments separate", () => {
    for (const args of [
      [],
      ["--write", "--repository", workflowActivationRepository, "--decision", "/tmp/d", "--permit", "/tmp/p"],
      ["--online", "--repository", workflowActivationRepository, "--decision", "/tmp/d", "--permit", "/tmp/p"],
      ["--recover", "--write"],
      ["--recover", "--permit", "/tmp/p"],
      ["--unknown"],
    ]) {
      const result = spawnSync(process.execPath, [
        "scripts/apply-cli-first-publication-workflow-activation.mjs",
        ...args,
      ], { cwd: repositoryRoot, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr,
        /^first_publication_workflow_activation_apply_arguments_invalid:/u);
    }
  });
});
