import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, it } from "vitest";
import { parse } from "yaml";

const workflowPath = resolve(
  import.meta.dirname,
  "../../../.github/workflows/release-pull-request.yml",
);
const scriptPath = resolve(import.meta.dirname, "../lib/reconcile-release-pull-request.sh");
const entrypointPath = resolve(import.meta.dirname, "../commands/reconcile-release-workflow.mjs");
// The workflow entrypoint as it existed before the pull-request operation.
const legacyEntrypoint = `import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scripts = {
  candidate: new URL("../lib/reconcile-release-candidate.sh", import.meta.url),
  tag: new URL("../lib/reconcile-release-tag.sh", import.meta.url),
};
const script = scripts[process.argv[2]];
if (!script) throw new Error("release_workflow_operation_invalid");
const result = spawnSync("bash", [fileURLToPath(script)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
`;
const bot = "lervo-release[bot]";
const roots = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("CLI release in pull request workflow", () => {
  it("prepares only same-repository pull requests on an explicit trigger", async () => {
    const source = await readFile(workflowPath, "utf8");
    const workflow = parse(source);
    assert.deepEqual(workflow.on.pull_request, { types: ["labeled"] });
    assert.equal(workflow.on.workflow_dispatch.inputs.pull_request.required, true);
    assert.deepEqual(workflow.permissions, {
      actions: "write",
      contents: "write",
      "pull-requests": "read",
    });
    assert.equal(workflow.concurrency["cancel-in-progress"], false);
    assert.match(workflow["run-name"], /^Prepare release in PR #/u);
    assert.doesNotMatch(source, /pull_request_target|NODE_AUTH_TOKEN|NPM_TOKEN|npm publish/u);
    const job = workflow.jobs.prepare;
    assert.equal(job["runs-on"], "macos-15");
    assert.match(job.if, /github\.event\.label\.name == 'release'/u);
    assert.match(job.if, /pull_request\.head\.repo\.full_name == github\.repository/u);
    const [resolveStep, tooling, checkout] = job.steps;
    assert.match(resolveStep.run, /isCrossRepository == false/u);
    assert.match(resolveStep.run, /baseRefName == "main"/u);
    assert.match(resolveStep.run, /IN\("main", "lervo\/release-cli"\)/u);
    assert.deepEqual(tooling.with, {
      ref: "${{ github.sha }}",
      path: "tooling",
      "persist-credentials": false,
    });
    assert.deepEqual(checkout.with, {
      ref: "${{ steps.target.outputs.head_sha }}",
      path: "pr",
      "fetch-depth": 0,
      "persist-credentials": true,
    });
    const install = job.steps.find(({ name }) => name === "Install dependencies");
    assert.equal(install["working-directory"], "pr");
    const prepare = job.steps.find(({ id }) => id === "prepare");
    assert.equal(
      prepare.run,
      'node tooling/scripts/release/commands/reconcile-release-workflow.mjs pull-request "${GITHUB_WORKSPACE}/pr"',
    );
    assert.equal(prepare.env.PR_HEAD_SHA, "${{ steps.target.outputs.head_sha }}");
    assert.ok(job.steps.indexOf(install) < job.steps.indexOf(prepare));
  });

  it("pushes one preparation commit on current main and dispatches its exact verification", async () => {
    const repo = await fixture();
    const first = repo.run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(await readFile(repo.output, "utf8"), /^disposition=prepared$/mu);
    const prepared = repo.remoteHead();
    assert.equal(repo.git("rev-parse", `${prepared}^`), repo.featureSha);
    assert.equal(
      repo.git("log", "-1", "--format=%an %s", prepared),
      `${bot} chore(cli): prepare release`,
    );
    assert.deepEqual(
      repo.git("diff", "--name-only", repo.featureSha, prepared).split("\n").toSorted(),
      [
        ".changes/current-release.md",
        ".changes/relint_aaaaaaaaaaaaaaaaaaaaaaaa.yaml",
        "apps/cli/package.json",
      ],
    );
    assert.match(
      await readFile(repo.trace, "utf8"),
      new RegExp(
        `workflow run code-quality\\.yml --ref feature -f expected_sha=${prepared} -f base_sha=${repo.mainSha}`,
        "u",
      ),
    );
    assert.match(
      await readFile(repo.trace, "utf8"),
      new RegExp(
        `workflow run cli-release-matrix\\.yml --ref feature -f expected_sha=${prepared}$`,
        "mu",
      ),
    );

    await writeFile(repo.trace, "");
    const replay = repo.run({ PR_HEAD_SHA: prepared });
    assert.equal(replay.status, 0, replay.stderr);
    assert.match(await readFile(repo.output, "utf8"), /^disposition=current$/mu);
    assert.equal(repo.remoteHead(), prepared);
    assert.doesNotMatch(await readFile(repo.trace, "utf8"), /release:prepare --apply/u);
  });

  it("re-prepares on moved main by replacing only its own preparation commit", async () => {
    const repo = await fixture();
    assert.equal(repo.run().status, 0);
    const stale = repo.remoteHead();
    const movedMain = repo.advanceMain();
    const result = repo.run({ PR_HEAD_SHA: stale });
    assert.equal(result.status, 0, result.stderr);
    const prepared = repo.remoteHead();
    const merge = repo.git("rev-parse", `${prepared}^`);
    assert.equal(repo.git("rev-parse", `${merge}^1`), repo.featureSha);
    assert.equal(repo.git("rev-parse", `${merge}^2`), movedMain);
    assert.equal(repo.git("log", "-1", "--format=%s", merge), "Merge branch 'main' into feature");
    assert.notEqual(prepared, stale);
    assert.match(await readFile(repo.trace, "utf8"), new RegExp(`base_sha=${movedMain}`, "u"));
  });

  it("prepares a head that predates the pull-request operation with this revision's tooling", async () => {
    const repo = await fixture({ legacyHead: true });
    const own = repo.run(
      {},
      { entrypoint: resolve(repo.work, "scripts/release/commands/reconcile-release-workflow.mjs") },
    );
    assert.notEqual(own.status, 0);
    assert.match(own.stderr, /release_workflow_operation_invalid/u);
    assert.equal(repo.remoteHead(), repo.featureSha);

    const result = repo.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(repo.output, "utf8"), /^disposition=prepared$/mu);
    assert.equal(repo.git("rev-parse", `${repo.remoteHead()}^`), repo.featureSha);
    const direct = await fixture();
    assert.equal(direct.run({}, { entrypoint: scriptPath }).status, 0);
  });

  it("stops before any write when current main does not merge cleanly", async () => {
    const repo = await fixture();
    repo.advanceMain("feature.txt", "conflicting\n");
    const result = repo.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /release_pull_request_merge_conflict/u);
    assert.equal(repo.remoteHead(), repo.featureSha);
    assert.doesNotMatch(await readFile(repo.trace, "utf8"), /release:prepare|workflow run/u);
  });

  it("writes nothing when the pull request moved or closed after observation", async () => {
    const repo = await fixture({ prState: "CLOSED" });
    const result = repo.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /release_pull_request_superseded/u);
    assert.equal(repo.remoteHead(), repo.featureSha);
    assert.doesNotMatch(await readFile(repo.trace, "utf8"), /workflow run/u);
    const moved = repo.run({ PR_HEAD_SHA: repo.mainSha });
    assert.equal(moved.status, 1);
    assert.match(moved.stderr, /release_pull_request_superseded/u);
    for (const ref of ["main", "lervo/release-cli"]) {
      const ineligible = repo.run({ PR_HEAD_REF: ref });
      assert.equal(ineligible.status, 1);
      assert.match(ineligible.stderr, /release_pull_request_ineligible/u);
    }
    assert.equal(repo.remoteHead(), repo.featureSha);
  });
});

async function fixture({ prState = "OPEN", legacyHead = false } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-release-pr-"));
  roots.push(root);
  const remote = resolve(root, "remote.git");
  const work = resolve(root, "work");
  const bin = resolve(root, "bin");
  const trace = resolve(root, "trace.log");
  const output = resolve(root, "output");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: work,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", remote]);
  await mkdir(resolve(work, "apps/cli"), { recursive: true });
  await mkdir(resolve(work, ".changes"), { recursive: true });
  await mkdir(bin);
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "Fixture Author");
  git("config", "user.email", "fixture@example.invalid");
  git("remote", "add", "origin", remote);
  await writeFile(resolve(work, "apps/cli/package.json"), '{"version":"0.1.0"}\n');
  for (const path of [
    "apps/cli/release-artifact-manifest.json",
    "apps/cli/release-sbom.cdx.json",
    "pnpm-lock.yaml",
  ])
    await writeFile(resolve(work, path), "{}\n");
  await writeFile(resolve(work, "README.md"), "base\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "chore: base");
  git("push", "--quiet", "origin", "main");
  const mainSha = git("rev-parse", "HEAD");
  git("switch", "--quiet", "-c", "feature");
  await writeFile(resolve(work, "feature.txt"), "feature\n");
  if (legacyHead) {
    await mkdir(resolve(work, "scripts/release/commands"), { recursive: true });
    await writeFile(
      resolve(work, "scripts/release/commands/reconcile-release-workflow.mjs"),
      legacyEntrypoint,
    );
  }
  await writeFile(
    resolve(work, ".changes/relint_aaaaaaaaaaaaaaaaaaaaaaaa.yaml"),
    "impact: patch\n",
  );
  git("add", "-A");
  git("commit", "--quiet", "-m", "feat: add feature");
  git("push", "--quiet", "origin", "feature");
  const featureSha = git("rev-parse", "HEAD");
  const fakes = {
    // Release owners are exercised elsewhere; this fixture records them and mutates release paths.
    pnpm: `#!/bin/bash
printf 'pnpm %s\\n' "$*" >>"$FIXTURE_TRACE"
case "$1 $2" in
  'release:prepare --json') echo '{"planId":"relprep_cccccccccccccccccccccccc"}' ;;
  'release:prepare --apply')
    echo '{"version":"0.1.1"}' >apps/cli/package.json
    rm -f .changes/relint_*.yaml
    echo 'notes' >.changes/current-release.md ;;
esac
`,
    gh: `#!/bin/bash
printf 'gh %s\\n' "$*" >>"$FIXTURE_TRACE"
case "$1 $2" in
  'pr view') echo "$FIXTURE_PR_STATE $FIXTURE_REMOTE_HEAD" ;;
  'api --method') echo 'total 0' ;;
  'workflow run') ;;
  *) exit 2 ;;
esac
`,
  };
  for (const [name, content] of Object.entries(fakes)) {
    await writeFile(resolve(bin, name), content);
    await chmod(resolve(bin, name), 0o755);
  }
  await writeFile(trace, "");
  const remoteHead = () =>
    execFileSync("git", ["rev-parse", "refs/heads/feature"], {
      cwd: remote,
      encoding: "utf8",
    }).trim();
  return {
    trace,
    output,
    work,
    mainSha,
    featureSha,
    git,
    remoteHead,
    advanceMain(path = "README.md", content = "moved\n") {
      git("switch", "--quiet", "main");
      git("pull", "--quiet", "--ff-only", "origin", "main");
      writeFileSync(resolve(work, path), content);
      git("add", "-A");
      git("commit", "--quiet", "-m", "docs: move main");
      git("push", "--quiet", "origin", "main");
      this.mainSha = git("rev-parse", "HEAD");
      return this.mainSha;
    },
    run(overrides = {}, { entrypoint = entrypointPath } = {}) {
      const head = overrides.PR_HEAD_SHA ?? featureSha;
      git("checkout", "--quiet", "--detach", remoteHead());
      // Like the workflow, run outside the worktree and name it explicitly.
      const command =
        entrypoint === scriptPath
          ? ["bash", [scriptPath, work]]
          : [process.execPath, [entrypoint, "pull-request", work]];
      return spawnSync(command[0], command[1], {
        cwd: root,
        encoding: "utf8",
        timeout: 20_000,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FIXTURE_TRACE: trace,
          FIXTURE_PR_STATE: prState,
          FIXTURE_REMOTE_HEAD: remoteHead(),
          GITHUB_REPOSITORY: "owner/lervo",
          GITHUB_OUTPUT: output,
          PR_NUMBER: "7",
          PR_HEAD_REF: "feature",
          PR_HEAD_SHA: head,
          ...overrides,
        },
      });
    },
  };
}
