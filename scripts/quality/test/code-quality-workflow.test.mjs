import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";
import { parse } from "yaml";

const workflowPath = resolve(import.meta.dirname, "../../../.github/workflows/code-quality.yml");

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
});
