import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

  it("builds once and shares exact outputs with every full-test consumer", async () => {
    const workflow = parse(await readFile(workflowPath, "utf8"));
    const job = workflow.jobs["release-artifacts"];
    assert.equal(job["runs-on"], "ubuntu-latest");
    assert.deepEqual(job.needs, ["quality", "native-runtime"]);
    assert.match(job.if, /needs\.quality\.outputs\.coverage == 'full'/u);
    assert.match(job.if, /needs\.native-runtime\.result == 'success'/u);
    const commands = job.steps.map(({ run }) => run).filter(Boolean);
    assert.ok(commands.includes("pnpm build"));
    assert.ok(commands.includes("pnpm release:manifest:check"));
    assert.ok(commands.includes("pnpm release:sbom:check"));
    const nativeRestore = commands.findIndex((run) =>
      run.includes("native-runtime-transfer.mjs restore"),
    );
    assert.ok(nativeRestore >= 0 && nativeRestore < commands.indexOf("pnpm build"));
    assert.equal(workflow.jobs["native-runtime"]["runs-on"], "macos-latest");
    const nativeDownload = job.steps.find(
      ({ uses, with: options }) =>
        uses?.startsWith("actions/download-artifact@") && options?.name === "native-runtime",
    );
    assert.ok(nativeDownload);
    const upload = job.steps.find(({ uses }) => uses?.startsWith("actions/upload-artifact@"));
    assert.equal(upload.with["retention-days"], 3);
    for (const consumer of [workflow.jobs.test, workflow.jobs.distribution]) {
      assert.ok(consumer.needs.includes("release-artifacts"));
      assert.ok(consumer.steps.some(({ uses }) => uses?.startsWith("actions/download-artifact@")));
      assert.ok(consumer.steps.some(({ run }) => run?.includes("ci-build.mjs restore")));
      assert.ok(!consumer.steps.some(({ run }) => run === "pnpm build"));
    }
  });

  it("runs the whole test suite in bounded shards after a build", async () => {
    const workflow = parse(await readFile(workflowPath, "utf8"));
    const job = workflow.jobs.test;
    assert.deepEqual(job.strategy.matrix.shard, [1, 2, 3, 4]);
    assert.equal(job.strategy["fail-fast"], false);
    assert.ok(job["timeout-minutes"] <= 60);
    const runs = job.steps.map(({ run }) => run).filter(Boolean);
    assert.ok(
      runs.findIndex((run) => run.includes("ci-build.mjs restore")) <
        runs.findIndex((run) => run.startsWith("pnpm test")),
    );
    assert.equal(
      runs.at(-1),
      "pnpm test --maxWorkers=2 --testTimeout=30000 --config=scripts/quality/ci-vitest.config.mjs --shard=${{ matrix.shard }}/4",
    );
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

it("keeps a full daily/manual fallback and rejects stale explicit candidates", async () => {
  const workflow = parse(await readFile(workflowPath, "utf8"));
  assert.ok(workflow.on.schedule.length > 0);
  assert.ok(workflow.on.workflow_dispatch.inputs.expected_sha);
  assert.ok(
    workflow.jobs.quality.steps.some(({ run }) => run === "node scripts/quality/ci-plan.mjs"),
  );
  assert.ok(workflow.jobs.quality.if.includes("head.repo.full_name != github.repository"));
  assert.deepEqual(workflow.jobs.verification.needs, [
    "quality",
    "release-artifacts",
    "test",
    "distribution",
  ]);
  assert.ok(workflow.jobs.verification.if.includes("always()"));
});

it("reuses only components that an earlier run executed for identical content", async () => {
  const workflow = parse(await readFile(workflowPath, "utf8"));
  assert.equal(workflow.permissions.actions, "read");
  const quality = workflow.jobs.quality;
  const plan = quality.steps.findIndex(({ id }) => id === "reuse");
  assert.ok(plan > quality.steps.findIndex(({ id }) => id === "distribution"));
  assert.equal(quality.steps[plan].run, "node scripts/quality/ci-reuse.mjs");
  for (const name of [
    "Check code quality",
    "Check architecture boundaries",
    "Check documentation lifecycle",
    "Check branding and natural-language contracts",
  ])
    assert.equal(
      quality.steps.find((step) => step.name === name).if,
      "steps.reuse.outputs.reuseQuality != 'true'",
    );
  for (const name of ["Check introduced commits", "Check pull-request release completion"])
    assert.ok(!quality.steps.find((step) => step.name === name).if?.includes("reuse"));
  assert.match(workflow.jobs["native-runtime"].if, /reuseBuild == ''/u);
  for (const [job, output] of [
    ["release-artifacts", "reuseBuild"],
    ["test", "reuseTests"],
    ["distribution", "reuseDistribution"],
  ]) {
    const definition = workflow.jobs[job];
    assert.equal(definition.env.REUSED_RUN, `\${{ needs.quality.outputs.${output} }}`);
    const [reuse, ...rest] = definition.steps;
    assert.equal(reuse.if, "env.REUSED_RUN != ''");
    for (const step of rest) assert.match(step.if, /^env\.REUSED_RUN == ''/u);
  }
  const metadata = workflow.jobs["release-artifacts"].steps.find((step) =>
    step.run?.includes("scripts/release/test"),
  );
  assert.match(metadata.if, /reuseTests != ''/u);
  const uploads = workflow.jobs.verification.steps.filter(({ uses }) =>
    uses?.startsWith("actions/upload-artifact@"),
  );
  assert.deepEqual(
    uploads.map(({ with: options }) => options.name),
    [
      "lervo-ci-build-${{ needs.quality.outputs.tree }}",
      "lervo-ci-tests-${{ needs.quality.outputs.testDigest }}",
      "lervo-ci-distribution-${{ needs.quality.outputs.tree }}",
    ],
  );
});

it("verifies distribution wherever main will reuse the result", async () => {
  const workflow = parse(await readFile(workflowPath, "utf8"));
  const step = workflow.jobs.quality.steps.find(({ id }) => id === "distribution");
  const root = await mkdtemp(resolve(tmpdir(), "lervo-ci-distribution-"));
  const plan = async ({ eventName, coverage = "full", pendingIntent }) => {
    await rm(resolve(root, ".changes"), { recursive: true, force: true });
    await mkdir(resolve(root, ".changes"));
    if (pendingIntent) await writeFile(resolve(root, ".changes/relint_a.yaml"), "impact: patch\n");
    const output = resolve(root, "output");
    await writeFile(output, "");
    const script = step.run
      .replaceAll("${{ steps.plan.outputs.coverage }}", coverage)
      .replaceAll("${{ github.event_name }}", eventName);
    const result = spawnSync("bash", ["-c", script], {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: output },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return (await readFile(output, "utf8")).trim();
  };
  try {
    for (const eventName of ["pull_request", "push"]) {
      assert.equal(await plan({ eventName, pendingIntent: false }), "required=true");
      assert.equal(await plan({ eventName, pendingIntent: true }), "required=false");
    }
    for (const eventName of ["workflow_dispatch", "schedule"])
      assert.equal(await plan({ eventName, pendingIntent: true }), "required=true");
    assert.equal(
      await plan({
        eventName: "pull_request",
        coverage: "documentation_only",
        pendingIntent: false,
      }),
      "required=false",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
