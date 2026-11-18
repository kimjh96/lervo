import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterAll, beforeAll, describe, it } from "vitest";
import { parse } from "yaml";

import { workflowConditionHolds, evaluateWorkflowValue } from "./fixtures/workflow-expression.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const workflow = parse(
  await readFile(resolve(repositoryRoot, ".github/workflows/code-quality.yml"), "utf8"),
);
const reuseJob = workflow.jobs["native-runtime-reuse"];
const buildJob = workflow.jobs["native-runtime"];
const consumerJob = workflow.jobs["release-artifacts"];
// Only these paths decide the native input key, so the fixture copies them and nothing else.
const fixturePaths = [
  "scripts/distribution/native-runtime-reuse.mjs",
  "scripts/distribution/lib",
  "scripts/shared",
  "packages/cas/native",
  "packages/cas/scripts",
  "packages/filesystem-durability/native",
  "packages/filesystem-durability/scripts",
];
const repository = "owner/repo";

let root, fixtureRoot, fakeBin, publishedArtifact;

/** Runs the real `find` step against the fixture with a fake `gh` that knows one artifact. */
function find({ artifact = publishedArtifact, api = "ok" } = {}) {
  const output = resolve(root, `find-${Math.random().toString(16).slice(2)}`);
  const result = spawnSync(
    process.execPath,
    [resolve(fixtureRoot, "scripts/distribution/native-runtime-reuse.mjs"), "find"],
    {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: {
        PATH: `${fakeBin}:${dirname(process.execPath)}:${process.env.PATH}`,
        GITHUB_REPOSITORY: repository,
        GITHUB_OUTPUT: output,
        FAKE_GH_ARTIFACT: artifact ?? "",
        FAKE_GH_API: api,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result;
}

const findOutputs = async (options) => JSON.parse(find(options).stdout);

let outputFiles = 0;
/** Runs a step command that only writes step outputs, and returns what it wrote. */
function runOutputStep(command) {
  const file = resolve(root, `output-${outputFiles++}`);
  const result = spawnSync("bash", ["-c", command], {
    env: { ...process.env, GITHUB_OUTPUT: file },
  });
  assert.equal(result.status, 0, String(result.stderr));
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
}

/** Walks the reuse job's steps as GitHub would, given the outcome of each step that runs. */
function simulateReuseJob({ event, found, outcomes = {} }) {
  const steps = {};
  for (const step of reuseJob.steps) {
    // Checkout and Node setup have no id and no condition; every later step has both.
    if (!step.id) continue;
    const runs = workflowConditionHolds(step.if, { github: { event_name: event }, steps });
    let outputs = {};
    if (runs && step.id === "find") outputs = found;
    if (runs && step.id === "reused") outputs = runOutputStep(step.run);
    steps[step.id] = { outcome: runs ? (outcomes[step.id] ?? "success") : "skipped", outputs };
  }
  return Object.fromEntries(
    Object.entries(reuseJob.outputs).map(([name, expression]) => [
      name,
      String(evaluateWorkflowValue(expression, { steps })),
    ]),
  );
}

/** Decides which jobs run after the reuse job, as GitHub evaluates their conditions. */
function downstream({ event, reuseOutputs, buildResult = "success" }) {
  const needs = {
    plan: { result: "success", outputs: { coverage: "full", reuseBuild: "" } },
    "native-runtime-reuse": { result: "success", outputs: reuseOutputs },
  };
  const context = {
    github: { event_name: event },
    needs,
    functions: { cancelled: () => false },
  };
  const builds = workflowConditionHolds(buildJob.if, context);
  needs["native-runtime"] = { result: builds ? buildResult : "skipped" };
  const consumes = workflowConditionHolds(consumerJob.if, context, {
    earlierSucceeded: Object.values(needs).every(({ result }) => result === "success"),
  });
  return { builds, consumes };
}

beforeAll(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-native-reuse-workflow-"));
  fixtureRoot = resolve(root, "repository");
  for (const path of fixturePaths)
    await cp(resolve(repositoryRoot, path), resolve(fixtureRoot, path), { recursive: true });
  fakeBin = resolve(root, "bin");
  await mkdir(fakeBin);
  // A Code quality run on main published the artifact named in FAKE_GH_ARTIFACT, and nothing else.
  await writeFile(
    resolve(fakeBin, "gh"),
    `#!/usr/bin/env node
const path = process.argv[3];
if (process.env.FAKE_GH_API !== "ok") process.exit(1);
const name = process.env.FAKE_GH_ARTIFACT;
const reply = (value) => process.stdout.write(JSON.stringify(value));
if (path.startsWith("repos/${repository}/actions/artifacts?name=")) {
  const requested = new URLSearchParams(path.split("?")[1]).get("name");
  reply({ artifacts: requested === name ? [{ name, expired: false, workflow_run: { id: 7 } }] : [] });
} else if (path === "repos/${repository}/actions/runs/7") {
  reply({ path: ".github/workflows/code-quality.yml", status: "completed", conclusion: "success",
    event: "push", head_branch: "main", repository: { full_name: "${repository}" },
    head_repository: { full_name: "${repository}" } });
} else if (path.startsWith("repos/${repository}/actions/runs/7/jobs")) {
  reply({ jobs: [{ name: "Native runtime artifacts", conclusion: "success" }] });
} else process.exit(1);
`,
  );
  await chmod(resolve(fakeBin, "gh"), 0o755);
  const { key, run } = await findOutputs({ artifact: "" });
  assert.equal(run, "");
  publishedArtifact = `lervo-native-runtime-${key}`;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Code quality darwin native reuse", () => {
  it("reuses the verified build when no native input changed, so macOS never starts", async () => {
    const found = await findOutputs();
    assert.equal(found.run, "7");
    assert.equal(found.artifact, publishedArtifact);
    const reuseOutputs = simulateReuseJob({ event: "pull_request", found });
    assert.equal(reuseOutputs.restored, "true");
    assert.deepEqual(downstream({ event: "pull_request", reuseOutputs }), {
      builds: false,
      consumes: true,
    });
  });

  it("builds on macOS when a native input changed, because the new key has no verified build", async () => {
    const source = resolve(fixtureRoot, "packages/filesystem-durability/native/sync-group.c");
    const original = await readFile(source);
    try {
      await writeFile(source, Buffer.concat([original, Buffer.from("\n/* changed */\n")]));
      const found = await findOutputs();
      assert.equal(found.run, "");
      assert.notEqual(`lervo-native-runtime-${found.key}`, publishedArtifact);
      const reuseOutputs = simulateReuseJob({ event: "pull_request", found });
      assert.equal(reuseOutputs.restored, "");
      assert.deepEqual(downstream({ event: "pull_request", reuseOutputs }), {
        builds: true,
        consumes: true,
      });
    } finally {
      await writeFile(source, original);
    }
  });

  it.each([
    ["no artifact for the key", { artifact: "" }, {}],
    ["an API failure", { api: "down" }, {}],
    ["a failed download", {}, { download: "failure" }],
    ["a build that fails validation", {}, { restore: "failure" }],
    ["a failed transfer upload", {}, { share: "failure" }],
  ])("builds on macOS after a cache miss: %s", async (_label, lookup, outcomes) => {
    const found = await findOutputs(lookup);
    const reuseOutputs = simulateReuseJob({ event: "push", found, outcomes });
    assert.equal(reuseOutputs.restored, "");
    const { builds, consumes } = downstream({ event: "push", reuseOutputs });
    assert.equal(builds, true);
    assert.equal(consumes, true);
    // A failed macOS build after a miss never lets the consumer run on missing native files.
    assert.equal(
      downstream({ event: "push", reuseOutputs, buildResult: "failure" }).consumes,
      false,
    );
  });

  it("makes the daily audit compile and compare instead of reusing", async () => {
    const found = await findOutputs();
    const buildSteps = (event, reuseOutputs) => {
      const steps = {};
      const ran = [];
      for (const step of buildJob.steps) {
        const context = {
          github: { event_name: event },
          needs: { "native-runtime-reuse": { outputs: reuseOutputs } },
          steps,
        };
        const runs = workflowConditionHolds(step.if, context);
        if (runs) ran.push(step.name);
        if (step.id) steps[step.id] = { outcome: runs ? "success" : "skipped" };
      }
      return ran;
    };
    const reuseOutputs = simulateReuseJob({ event: "schedule", found });
    assert.equal(reuseOutputs.restored, "");
    assert.equal(reuseOutputs.run, "7");
    assert.equal(downstream({ event: "schedule", reuseOutputs }).builds, true);
    const ran = buildSteps("schedule", reuseOutputs);
    assert.ok(ran.includes("Require the reusable build to equal this build"));
    assert.ok(ran.includes("Offer this build for identical native inputs"));
    // A pull request that fell back to macOS after a failed restore offers its build but never
    // compares it with the build it could not use.
    const fallback = simulateReuseJob({
      event: "pull_request",
      found,
      outcomes: { restore: "failure" },
    });
    const fallbackSteps = buildSteps("pull_request", fallback);
    assert.ok(!fallbackSteps.includes("Require the reusable build to equal this build"));
    assert.ok(fallbackSteps.includes("Offer this build for identical native inputs"));
    const compare = buildJob.steps.find(
      (step) => step.name === "Require the reusable build to equal this build",
    );
    assert.equal(compare["continue-on-error"], undefined);
  });

  it("keeps the consumer's native input identical whichever job produced it", () => {
    for (const job of [reuseJob, buildJob]) {
      const share = job.steps.find((step) => step.name === "Share exact native artifact");
      assert.equal(share.with.name, "native-runtime");
      assert.equal(share.with.path, "${{ runner.temp }}/native-runtime");
      assert.ok(
        job.steps.some(
          (step) =>
            step.run ===
            'node scripts/distribution/native-runtime-transfer.mjs create "${{ runner.temp }}/native-runtime"',
        ),
      );
    }
    assert.equal(reuseJob["runs-on"], "ubuntu-latest");
    assert.equal(buildJob["runs-on"], "macos-15");
    const restore = consumerJob.steps.find((step) =>
      step.run?.includes("native-runtime-transfer.mjs restore"),
    );
    assert.ok(restore);
    // Reuse only offers a build that the pinned-toolchain job itself compiled.
    const names = buildJob.steps.map((step) => step.name);
    assert.ok(
      names.indexOf("Check the pinned darwin toolchain") <
        names.indexOf("Key this build by its native inputs"),
    );
    // The offer is named by the key that the compiling job computed and is kept for 30 days.
    const offer = buildJob.steps.find(
      (step) => step.name === "Offer this build for identical native inputs",
    );
    assert.deepEqual(offer.with, {
      name: "${{ steps.reusable.outputs.artifact }}",
      path: "${{ runner.temp }}/native-runtime-reusable",
      "if-no-files-found": "error",
      "retention-days": 30,
    });
  });
});
