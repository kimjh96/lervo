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
    assert.equal(workflow.jobs["native-runtime"]["runs-on"], "macos-15");
    const nativeDownload = job.steps.find(
      ({ uses, with: options }) =>
        uses?.startsWith("actions/download-artifact@") && options?.name === "native-runtime",
    );
    assert.ok(nativeDownload);
    const upload = job.steps.find(({ name }) => name === "Share exact build with test consumers");
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
    // The build job first names its release metadata mode, which tag admission reads.
    const [reuse, ...rest] = definition.steps.slice(job === "release-artifacts" ? 1 : 0);
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
      "${{ needs.plan.outputs.buildReceipt }}",
      "lervo-ci-tests-${{ needs.plan.outputs.testDigest }}",
      "lervo-ci-distribution-${{ needs.plan.outputs.tree }}",
    ],
  );
});

it("checks committed release metadata exactly or generates it, as the plan decides", async () => {
  const workflow = parse(await readFile(workflowPath, "utf8"));
  const reuse = workflow.jobs.plan.steps.find(({ id }) => id === "reuse");
  assert.equal(reuse.env.RELEASE_METADATA, "${{ steps.plan.outputs.releaseMetadata }}");
  assert.equal(
    workflow.jobs.plan.outputs.releaseMetadata,
    "${{ steps.plan.outputs.releaseMetadata }}",
  );
  assert.equal(workflow.jobs.plan.outputs.buildReceipt, "${{ steps.reuse.outputs.buildReceipt }}");
  const steps = workflow.jobs["release-artifacts"].steps;
  const names = steps.map(({ name }) => name);
  // Tag admission (ci-release-admission.mjs) requires "Release metadata mode: exact"; the step runs
  // whether or not the build is reused, and anything but `generated` renders as exact.
  assert.equal(
    steps[0].name,
    "Release metadata mode: ${{ needs.plan.outputs.releaseMetadata == 'generated' && 'generated' || 'exact' }}",
  );
  assert.equal(steps[0].if, undefined);
  const admission = await readFile(
    resolve(repositoryRoot, "scripts/release/lib/ci-release-admission.mjs"),
    "utf8",
  );
  assert.match(admission, /"Release metadata mode: exact"/u);
  const step = (name) => steps[names.indexOf(name)];
  // Anything but an explicit `generated` decision checks the committed bytes.
  for (const name of ["Verify release manifest", "Verify release SBOM"])
    assert.equal(
      step(name).if,
      "env.REUSED_RUN == '' && needs.plan.outputs.releaseMetadata != 'generated'",
    );
  const generated = [
    "Generate release manifest and SBOM from this build",
    "Report generated release metadata",
    "Share generated release metadata",
  ];
  assert.deepEqual(
    [step("Verify release manifest").id, step("Verify release SBOM").id, step(generated[0]).id],
    ["manifest", "sbom", "generate"],
  );
  // Generated mode keeps the committed platform families, so a new family fails like the check.
  assert.equal(
    step(generated[0]).if,
    "env.REUSED_RUN == '' && needs.plan.outputs.releaseMetadata == 'generated'",
  );
  assert.equal(
    step(generated[0]).run,
    "pnpm release:manifest:update --committed-families && pnpm release:sbom:update",
  );
  // Any failed check or generation gets the files to commit, with families inferred as release
  // preparation infers them.
  const failed =
    "steps.manifest.outcome == 'failure' || steps.sbom.outcome == 'failure' || steps.generate.outcome == 'failure'";
  const toCommit = step("Generate release metadata to commit");
  assert.equal(toCommit.if, `env.REUSED_RUN == '' && failure() && (${failed})`);
  assert.equal(toCommit.run, "pnpm release:manifest:update && pnpm release:sbom:update");
  for (const name of generated.slice(1))
    assert.equal(
      step(name).if,
      `env.REUSED_RUN == '' && ((success() && needs.plan.outputs.releaseMetadata == 'generated') || (failure() && (${failed})))`,
    );
  assert.equal(step(generated[1]).shell, "bash");
  assert.equal(
    step(generated[1]).env.REPORT_MODE,
    `\${{ (${failed}) && 'exact' || needs.plan.outputs.releaseMetadata }}`,
  );
  assert.match(
    step(generated[1]).run,
    /report-cli-release-metadata\.mjs "\$\{REPORT_MODE\}" \| tee -a/u,
  );
  assert.equal(step(generated[2]).with.name, "lervo-cli-release-metadata");
  assert.deepEqual(step(generated[2]).with.path.trim().split("\n"), [
    "apps/cli/release-artifact-manifest.json",
    "apps/cli/release-sbom.cdx.json",
  ]);
  // Generation follows the build and precedes the metadata tests and the shared archive, so the
  // tests and every consumer of the archive see the same release metadata.
  const order = [
    "Build release artifact",
    generated[0],
    "Generate release metadata to commit",
    ...generated.slice(1),
    "Test release metadata that reused test results do not cover",
    "Archive exact build outputs",
  ].map((name) => names.indexOf(name));
  assert.ok(
    order.every((index, position) => index >= 0 && (position === 0 || index > order[position - 1])),
  );
});

it("starts the build beside lint while shards and the aggregate still require lint", async () => {
  const source = await readFile(workflowPath, "utf8");
  const workflow = parse(source);
  const { plan, quality } = workflow.jobs;
  assert.equal(quality.needs, "plan");
  assert.deepEqual(workflow.jobs["native-runtime"].needs, ["plan", "native-runtime-reuse"]);
  assert.equal(workflow.jobs["native-runtime-reuse"].needs, "plan");
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

it("records test input ledgers without changing which tests run or the verdict", async () => {
  const source = await readFile(workflowPath, "utf8");
  const workflow = parse(source);
  const job = workflow.jobs.test;
  assert.equal(job.env.LERVO_CI_TEST_LEDGER, "${{ vars.LERVO_CI_TEST_LEDGER || 'on' }}");
  const names = job.steps.map(({ name }) => name);
  const run = job.steps[names.indexOf("Run tests")];
  assert.equal(run.env.LERVO_CI_TEST_LEDGER_DIRECTORY, "${{ runner.temp }}/lervo-ci-test-ledger");
  assert.equal(
    run.run,
    "pnpm test --maxWorkers=2 --testTimeout=30000 --config=scripts/quality/ci-vitest.config.mjs --shard=${{ matrix.shard }}/4",
  );
  const upload = job.steps.at(-1);
  assert.equal(upload.name, "Publish the test input ledger");
  assert.equal(names.indexOf("Run tests"), names.length - 2);
  assert.match(upload.uses, /^actions\/upload-artifact@[a-f0-9]{40}$/u);
  assert.equal(upload.if, "env.REUSED_RUN == '' && always() && env.LERVO_CI_TEST_LEDGER != 'off'");
  assert.equal(upload["continue-on-error"], true);
  assert.deepEqual(upload.with, {
    name: "lervo-ci-test-ledger-${{ matrix.shard }}",
    path: "${{ runner.temp }}/lervo-ci-test-ledger/ledger",
    "if-no-files-found": "ignore",
    "retention-days": 7,
    overwrite: true,
  });
  // Only the test job and the shadow comparison know the ledger; planning, reuse and the
  // aggregate never read it, and no job consumes the shadow comparison.
  for (const [name, definition] of Object.entries(workflow.jobs)) {
    if (name !== "test" && name !== "test-shadow")
      assert.doesNotMatch(JSON.stringify(definition), /LEDGER|ledger/u, name);
    assert.ok(![definition.needs ?? []].flat().includes("test-shadow"), name);
  }
  for (const script of ["ci-plan.mjs", "ci-reuse.mjs", "ci-result.mjs", "ci-receipt.mjs"])
    assert.doesNotMatch(
      await readFile(resolve(repositoryRoot, "scripts/quality", script), "utf8"),
      /ledger/iu,
      script,
    );
});

it("compares predicted test reuse in a shadow job that can never fail the run", async () => {
  const workflow = parse(await readFile(workflowPath, "utf8"));
  const job = workflow.jobs["test-shadow"];
  assert.deepEqual(job.needs, ["plan", "release-artifacts", "test"]);
  assert.equal(job["continue-on-error"], true);
  assert.equal(job.permissions, undefined);
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
  for (const condition of [
    "!cancelled()",
    "needs.plan.outputs.coverage == 'full'",
    "needs.plan.outputs.reuseTests == ''",
    "needs.release-artifacts.result == 'success'",
    "vars.LERVO_CI_TEST_LEDGER != 'off'",
  ])
    assert.ok(job.if.includes(condition), condition);
  for (const step of job.steps.filter(({ uses }) => uses))
    assert.match(step.uses, /^[a-z-]+\/[a-z-]+@[a-f0-9]{40}$/u, step.name);
  const names = job.steps.map(({ name }) => name);
  assert.ok(
    names.indexOf("Restore and validate exact build outputs") <
      names.indexOf("Compare predicted reuse with this run's results"),
  );
  const compare = job.steps[names.indexOf("Compare predicted reuse with this run's results")];
  assert.deepEqual(compare.env, { GH_TOKEN: "${{ github.token }}" });
  assert.match(compare.run, /^node scripts\/quality\/ci-test-shadow\.mjs /u);
  const uploads = job.steps.filter(({ uses }) => uses?.startsWith("actions/upload-artifact@"));
  assert.deepEqual(
    uploads.map(({ if: condition, with: options }) => [
      condition,
      options.name,
      options["retention-days"],
    ]),
    [
      ["always()", "lervo-ci-test-input-index", 7],
      ["always()", "lervo-ci-test-shadow", 30],
    ],
  );
  assert.ok(!workflow.jobs.verification.needs.includes("test-shadow"));
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
