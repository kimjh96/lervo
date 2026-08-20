import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { parse } from "yaml";

const workflowPath = resolve(
  import.meta.dirname,
  "../../.github/workflows/cli-release-matrix.yml",
);

async function readWorkflow() {
  return parse(await readFile(workflowPath, "utf8"));
}

describe("CLI release matrix workflow", () => {
  it("runs the packed CLI contract on all supported desktop platforms", async () => {
    const workflow = await readWorkflow();
    assert.deepEqual(Object.keys(workflow.on).sort(), [
      "pull_request",
      "push",
      "workflow_dispatch",
    ]);
    assert.deepEqual(workflow.permissions, { contents: "read" });
    const job = workflow.jobs["packed-cli"];
    assert.equal(job.strategy["fail-fast"], false);
    assert.deepEqual(job.strategy.matrix.os, [
      "ubuntu-latest",
      "macos-latest",
      "windows-latest",
    ]);
    assert.equal(job["timeout-minutes"], 20);
  });

  it("pins setup actions and the minimum supported Node release", async () => {
    const workflow = await readWorkflow();
    const steps = workflow.jobs["packed-cli"].steps;
    assert.deepEqual(steps.slice(0, 3).map(({ uses }) => uses), [
      "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9",
    ]);
    assert.equal(steps[0].with["persist-credentials"], false);
    assert.equal(steps[1].with["node-version"], "22.13.0");
    assert.equal(steps[1].with["package-manager-cache"], false);
  });

  it("builds once and checks both the release manifest and consumer install", async () => {
    const workflow = await readWorkflow();
    const commands = workflow.jobs["packed-cli"].steps
      .map(({ run }) => run)
      .filter(Boolean);
    assert.deepEqual(commands, [
      "pnpm install --frozen-lockfile",
      "pnpm build",
      "pnpm release:manifest:check",
      "pnpm release:sbom:check",
      "pnpm smoke:packed-cli",
      "pnpm smoke:registry-publish",
    ]);
  });
});
