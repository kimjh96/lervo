import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";
import { parse } from "yaml";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const workflowPath = resolve(repositoryRoot, ".github/workflows/code-quality.yml");

describe("code-quality workflow", () => {
  it("checks pull requests and direct main pushes against their exact base", async () => {
    const workflow = parse(await readFile(workflowPath, "utf8"));
    const steps = workflow.jobs.quality.steps;
    const checkout = steps.find(({ name }) => name === "Check out repository");
    const architecture = steps.find(({ name }) => name === "Check architecture boundaries");
    const pullRequest = steps.find(({ name }) => name === "Check pull-request release completion");
    const directMain = steps.find(({ name }) => name === "Check direct-main release completion");

    assert.equal(checkout.with["fetch-depth"], 0);
    assert.equal(checkout.with["persist-credentials"], false);
    assert.equal(architecture.run, "pnpm architecture:check");
    assert.equal(pullRequest.if, "github.event_name == 'pull_request'");
    assert.match(pullRequest.run, /release:completion:check --base/u);
    assert.match(pullRequest.run, /github\.event\.pull_request\.base\.sha/u);
    assert.equal(directMain.if, "github.event_name == 'push'");
    assert.match(directMain.run, /release:completion:check --base/u);
    assert.match(directMain.run, /github\.event\.before/u);
  });

  it("builds and checks the release manifest and SBOM on every pull request", async () => {
    const workflow = parse(await readFile(workflowPath, "utf8"));
    const job = workflow.jobs["release-artifacts"];
    assert.equal(job["runs-on"], "ubuntu-latest");
    assert.deepEqual(job.steps.map(({ run }) => run).filter(Boolean), [
      "pnpm install --frozen-lockfile",
      "pnpm build",
      "pnpm release:manifest:check",
      "pnpm release:sbom:check",
    ]);
  });

  it("runs the whole test suite in bounded shards after a build", async () => {
    const workflow = parse(await readFile(workflowPath, "utf8"));
    const job = workflow.jobs.test;
    assert.deepEqual(job.strategy.matrix.shard, [1, 2, 3, 4]);
    assert.equal(job.strategy["fail-fast"], false);
    assert.ok(job["timeout-minutes"] <= 60);
    const runs = job.steps.map(({ run }) => run).filter(Boolean);
    assert.ok(runs.indexOf("pnpm build") < runs.findIndex((run) => run.startsWith("pnpm test")));
    assert.equal(runs.at(-1), "pnpm test --maxWorkers=2 --shard=${{ matrix.shard }}/4");
  });

  it("typechecks against Node type definitions that track the engines minimum", async () => {
    const workflow = parse(await readFile(workflowPath, "utf8"));
    const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
    const steps = workflow.jobs.quality.steps;
    const setupNode = steps.find(({ name }) => name === "Set up Node");
    const install = steps.findIndex(({ name }) => name === "Install dependencies");
    const typecheck = steps.findIndex(
      ({ name }) => name === "Check types against the supported Node minimum",
    );
    const minimum = /^>=(\d+\.\d+)$/u.exec(manifest.engines.node)?.[1];

    assert.ok(minimum, "engines.node must declare one >=major.minor minimum");
    assert.equal(setupNode.with["node-version"], `${minimum}.0`);
    const [major, minor] = minimum.split(".");
    assert.match(
      manifest.devDependencies["@types/node"],
      new RegExp(`^~${major}\\.${minor}\\.\\d+$`, "u"),
    );
    assert.ok(typecheck > install, "typecheck must run after dependency installation");
    assert.equal(steps[typecheck].run, "pnpm typecheck");
  });
});
