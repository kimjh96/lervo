import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { authorizeCliFirstPublicationWorkflowActivation } from "../lib/cli-first-publication-workflow-activation-permit.mjs";
import { validateFirstPublicationWorkflowActivationDecision } from "../lib/first-publication-workflow-activation-decision.mjs";
import {
  createWorkflowActivationFixture,
  readyWorkflowActivationGitHubObservation,
  readyWorkflowActivationNpmObservation,
  workflowActivationRepository,
} from "./fixtures/first-publication-workflow-activation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function clock(...values) {
  return () => values.shift();
}

async function authorize(fixture, overrides = {}) {
  return authorizeCliFirstPublicationWorkflowActivation(
    {
      repository: workflowActivationRepository,
      decisionPath: fixture.decisionPath,
      outputPath: fixture.permitPath,
      online: true,
    },
    {
      paths: fixture.paths,
      observeNpm: async () => readyWorkflowActivationNpmObservation(),
      observeGitHub: async () => readyWorkflowActivationGitHubObservation(),
      clock: clock("2026-08-21T10:01:00Z", "2026-08-21T10:02:00Z"),
      ...overrides,
    },
  );
}

describe("first-publication workflow activation permit", () => {
  it("binds exact reviewed bytes to fresh stage-only external controls without applying", async () => {
    const fixture = await createWorkflowActivationFixture();
    try {
      const before = await readFile(fixture.paths.workflowPath);
      const permit = await authorize(fixture);
      assert.equal(permit.status, "apply_permitted");
      assert.equal(permit.authority.publication, "not_authorized");
      assert.equal(permit.binding.output.sha256, fixture.candidateResult.candidate.output.sha256);
      assert.equal(permit.readiness.report.status, "ready");
      assert.equal(permit.readiness.expiresAt, "2026-08-21T10:07:00.000Z");
      assert.deepEqual(await readFile(fixture.paths.workflowPath), before);
      assert.deepEqual(JSON.parse(await readFile(fixture.permitPath)), permit);
      assert.equal((await stat(fixture.permitPath)).mode & 0o777, 0o600);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects broad npm authority and source changes without leaving a permit", async () => {
    const blocked = await createWorkflowActivationFixture();
    try {
      await assert.rejects(
        authorize(blocked, {
          observeNpm: async () =>
            readyWorkflowActivationNpmObservation({
              permissions: ["createPackage", "createStagedPackage"],
            }),
        }),
        { code: "first_publication_workflow_activation_controls_not_ready" },
      );
      await assert.rejects(access(blocked.permitPath));
    } finally {
      await rm(blocked.root, { recursive: true, force: true });
    }

    const changed = await createWorkflowActivationFixture();
    try {
      await assert.rejects(
        authorize(changed, {
          observeGitHub: async () => {
            await writeFile(changed.paths.workflowPath, "name: changed\n");
            return readyWorkflowActivationGitHubObservation();
          },
        }),
        { code: "release_attestation_release_set_changed" },
      );
      await assert.rejects(access(changed.permitPath));
    } finally {
      await rm(changed.root, { recursive: true, force: true });
    }
  });

  it("rejects a redigested decision with widened confirmation or expired lifetime", async () => {
    const fixture = await createWorkflowActivationFixture();
    try {
      const widened = structuredClone(fixture.decision);
      widened.confirmations.push("also_allow_direct_publish");
      assert.throws(() => validateFirstPublicationWorkflowActivationDecision(widened), {
        code: "first_publication_workflow_activation_decision_invalid",
      });
      assert.throws(
        () =>
          validateFirstPublicationWorkflowActivationDecision(fixture.decision, {
            checkedAt: "2026-08-21T10:10:00Z",
          }),
        { code: "first_publication_workflow_activation_decision_expired" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects offline, relative, duplicate, and unknown command arguments", () => {
    for (const args of [
      [],
      ["--repository", workflowActivationRepository, "--decision", "/tmp/d", "--output", "/tmp/o"],
      [
        "--online",
        "--repository",
        workflowActivationRepository,
        "--decision",
        "relative",
        "--output",
        "/tmp/o",
      ],
      [
        "--online",
        "--online",
        "--repository",
        workflowActivationRepository,
        "--decision",
        "/tmp/d",
        "--output",
        "/tmp/o",
      ],
      ["--unknown"],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/authorize-cli-first-publication-workflow-activation.mjs", ...args],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(
        result.stderr,
        /^first_publication_workflow_activation_permit_arguments_invalid:/u,
      );
    }
  });
});
