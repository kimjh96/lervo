import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";
import { parse } from "yaml";

import { inspectCliFirstPublicationWorkflowActivationCandidate } from "../cli-first-publication-workflow-activation-candidate.mjs";
import {
  createFirstPublicationWorkflowActivationCandidate,
  stagePublicationPackageScript,
} from "../first-publication-workflow-activation-candidate.mjs";
import { formatFirstPublicationWorkflowActivationCandidate } from "../first-publication-workflow-activation-candidate-formatter.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../../..");
const command =
  "scripts/release/first-publication/workflow/commands/show-cli-first-publication-workflow-activation-candidate.mjs";

async function sourceFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workflow-candidate-"));
  const packageManifest = JSON.parse(await readFile(resolve(repositoryRoot, "package.json")));
  packageManifest.scripts["release:publication:stage"] = stagePublicationPackageScript;
  const paths = {
    packageManifestPath: resolve(root, "package.json"),
    workflowPath: resolve(root, "workflow.yml"),
  };
  await Promise.all([
    writeFile(paths.packageManifestPath, `${JSON.stringify(packageManifest, null, 2)}\n`),
    writeFile(
      paths.workflowPath,
      await readFile(resolve(repositoryRoot, ".github/workflows/cli-release-matrix.yml")),
    ),
  ]);
  return { root, paths };
}

describe("first-publication workflow activation candidate command", () => {
  it("returns separately verifiable metadata and workflow bytes without writes", async () => {
    const prepared = await sourceFixture();
    try {
      const before = await Promise.all([
        readFile(prepared.paths.packageManifestPath),
        readFile(prepared.paths.workflowPath),
      ]);
      const result = await inspectCliFirstPublicationWorkflowActivationCandidate(prepared.paths);
      assert.equal(result.candidate.status, "review_required");
      assert.equal(
        parse(result.outputBytes.toString("utf8")).jobs["publish-cli"].environment,
        "npm-release",
      );
      assert.deepEqual(
        await Promise.all([
          readFile(prepared.paths.packageManifestPath),
          readFile(prepared.paths.workflowPath),
        ]),
        before,
      );
      const output = formatFirstPublicationWorkflowActivationCandidate(result.candidate);
      assert.match(output, /Adds one publish-cli job/u);
      assert.match(output, /cannot yet be applied to the source workflow/u);
      assert.equal(output.includes(result.candidate.candidateDigest), false);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects source changes made while the candidate is built", async () => {
    const prepared = await sourceFixture();
    try {
      await assert.rejects(
        inspectCliFirstPublicationWorkflowActivationCandidate(prepared.paths, {
          createCandidate: async (input) => {
            const result = createFirstPublicationWorkflowActivationCandidate(input);
            await writeFile(prepared.paths.workflowPath, "name: changed\n");
            return result;
          },
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("builds a candidate from the current stage command without writing it", () => {
    const result = spawnSync(process.execPath, [command, "--json"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "review_required");
    assert.equal(result.stderr, "");
  });

  it("rejects an oversized workflow before candidate generation", async () => {
    const prepared = await sourceFixture();
    try {
      await writeFile(prepared.paths.workflowPath, "x".repeat(256 * 1024 + 1));
      await assert.rejects(inspectCliFirstPublicationWorkflowActivationCandidate(prepared.paths), {
        code: "first_publication_workflow_activation_source_invalid",
      });
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate, mixed, online, and unknown arguments before source output", () => {
    for (const args of [
      ["--json", "--json"],
      ["--json", "--workflow-yaml"],
      ["--workflow-yaml", "--workflow-yaml"],
      ["--online"],
      ["--unknown"],
    ]) {
      const result = spawnSync(process.execPath, [command, ...args], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(
        result.stderr,
        /^first_publication_workflow_activation_candidate_arguments_invalid:/u,
      );
    }
  });
});
