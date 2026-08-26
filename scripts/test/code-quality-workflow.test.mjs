import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";
import { parse } from "yaml";

const workflowPath = resolve(import.meta.dirname, "../../.github/workflows/code-quality.yml");

describe("code-quality workflow", () => {
  it("checks out the base history required by pull-request release-intent comparison", async () => {
    const workflow = parse(await readFile(workflowPath, "utf8"));
    const steps = workflow.jobs.quality.steps;
    const checkout = steps.find(({ name }) => name === "Check out repository");
    const releaseIntent = steps.find(({ name }) => name === "Check reviewed CLI release intent");

    assert.equal(checkout.with["fetch-depth"], 0);
    assert.equal(checkout.with["persist-credentials"], false);
    assert.match(releaseIntent.run, /github\.event\.pull_request\.base\.sha/u);
  });
});
