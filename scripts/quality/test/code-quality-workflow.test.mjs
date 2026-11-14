import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";

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
    assert.deepEqual(job.needs, ["plan", "native-runtime"]);
    assert.match(job.if, /needs\.plan\.outputs\.coverage == 'full'/u);
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
  assert.ok(workflow.jobs.plan.steps.some(({ run }) => run === "node scripts/quality/ci-plan.mjs"));
  assert.ok(workflow.jobs.plan.if.includes("head.repo.full_name != github.repository"));
  assert.deepEqual(workflow.jobs.verification.needs, [
    "plan",
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
  const { plan, quality } = workflow.jobs;
  const reuse = plan.steps.findIndex(({ id }) => id === "reuse");
  assert.ok(reuse > plan.steps.findIndex(({ id }) => id === "distribution"));
  assert.equal(plan.steps[reuse].run, "node scripts/quality/ci-reuse.mjs");
  for (const name of [
    "Check code quality",
    "Check architecture boundaries",
    "Check documentation lifecycle",
    "Check branding and natural-language contracts",
  ])
    assert.equal(
      quality.steps.find((step) => step.name === name).if,
      "needs.plan.outputs.reuseQuality != 'true'",
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
    assert.equal(definition.env.REUSED_RUN, `\${{ needs.plan.outputs.${output} }}`);
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
      "lervo-ci-build-${{ needs.plan.outputs.tree }}",
      "lervo-ci-tests-${{ needs.plan.outputs.testDigest }}",
      "lervo-ci-distribution-${{ needs.plan.outputs.tree }}",
    ],
  );
});

it("starts the build beside lint while shards and the aggregate still require lint", async () => {
  const source = await readFile(workflowPath, "utf8");
  const workflow = parse(source);
  const { plan, quality } = workflow.jobs;
  assert.equal(quality.needs, "plan");
  assert.equal(workflow.jobs["native-runtime"].needs, "plan");
  assert.ok(!workflow.jobs["release-artifacts"].needs.includes("quality"));
  assert.doesNotMatch(JSON.stringify(workflow.jobs["release-artifacts"]), /needs\.quality\./u);
  for (const job of ["test", "distribution"]) {
    assert.ok(workflow.jobs[job].needs.includes("quality"));
    assert.match(workflow.jobs[job].if, /needs\.quality\.result == 'success'/u);
  }
  assert.ok(["plan", "quality"].every((job) => workflow.jobs.verification.needs.includes(job)));
  // Every plan output a job reads is declared, and no job reads outputs from the lint job.
  assert.doesNotMatch(source, /needs\.quality\.outputs/u);
  for (const [, output] of source.matchAll(/needs\.plan\.outputs\.(\w+)/gu))
    assert.ok(output in plan.outputs, output);
  // Planning runs before dependencies are installed, so its scripts import only Node and themselves.
  assert.ok(!plan.steps.some(({ run, uses }) => run?.includes("pnpm") || uses?.includes("pnpm")));
  const pending = ["scripts/quality/ci-plan.mjs", "scripts/quality/ci-reuse.mjs"];
  for (const visited = new Set(); pending.length > 0;) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    const text = await readFile(resolve(repositoryRoot, path), "utf8");
    for (const [, specifier] of text.matchAll(/^import [^;]*? from "([^"]+)";/gmu)) {
      if (specifier.startsWith("."))
        pending.push(relative(repositoryRoot, resolve(repositoryRoot, dirname(path), specifier)));
      else assert.match(specifier, /^node:/u, `${path} imports ${specifier}`);
    }
  }
});

it("verifies distribution wherever main will reuse the result", async () => {
  const workflow = parse(await readFile(workflowPath, "utf8"));
  const step = workflow.jobs.plan.steps.find(({ id }) => id === "distribution");
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

it("shows a dispatched verification on its exact commit as a commit status", async () => {
  const workflow = parse(await readFile(workflowPath, "utf8"));
  const job = workflow.jobs["dispatched-status"];
  assert.deepEqual(job.needs, ["verification"]);
  assert.deepEqual(job.permissions, { statuses: "write" });
  assert.match(job.if, /always\(\)/u);
  assert.match(job.if, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(job.if, /inputs\.expected_sha != ''/u);
  const [step] = job.steps;
  assert.equal(step.env.EXPECTED_SHA, "${{ inputs.expected_sha }}");
  assert.equal(step.env.VERIFICATION, "${{ needs.verification.result }}");
  const root = await mkdtemp(resolve(tmpdir(), "lervo-ci-status-"));
  try {
    const trace = resolve(root, "trace.log");
    await writeFile(resolve(root, "gh"), `#!/bin/bash\nprintf '%s\\n' "$*" >>"${trace}"\n`, {
      mode: 0o755,
    });
    const post = async (env) => {
      await writeFile(trace, "");
      const result = spawnSync("bash", ["-e", "-c", step.run], {
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          GITHUB_REPOSITORY: "owner/lervo",
          GITHUB_RUN_ID: "42",
          GITHUB_SERVER_URL: "https://github.com",
          ...env,
        },
        encoding: "utf8",
      });
      return { status: result.status, calls: await readFile(trace, "utf8") };
    };
    const sha = "c".repeat(40);
    const passed = await post({ EXPECTED_SHA: sha, VERIFICATION: "success" });
    assert.equal(passed.status, 0);
    assert.match(passed.calls, new RegExp(`--method POST repos/owner/lervo/statuses/${sha}`, "u"));
    assert.match(passed.calls, /-f state=success -f context=CI verification \(lervo-ci-v1\)/u);
    assert.match(
      passed.calls,
      /target_url=https:\/\/github\.com\/owner\/lervo\/actions\/runs\/42/u,
    );
    for (const result of ["failure", "cancelled"])
      assert.match(
        (await post({ EXPECTED_SHA: sha, VERIFICATION: result })).calls,
        /-f state=failure /u,
      );
    const invalid = await post({ EXPECTED_SHA: "main", VERIFICATION: "success" });
    assert.equal(invalid.status, 1);
    assert.equal(invalid.calls, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
