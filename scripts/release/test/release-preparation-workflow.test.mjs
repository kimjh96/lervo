import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";
import { parse } from "yaml";
import { renderReleasePrBody } from "../lib/release-pr-body.mjs";

const workflowPath = resolve(
  import.meta.dirname,
  "../../../.github/workflows/release-preparation.yml",
);

async function readWorkflow() {
  return parse(await readFile(workflowPath, "utf8"));
}

describe("CLI release preparation workflow", () => {
  it("has repository and pull-request authority without registry authority", async () => {
    const workflow = await readWorkflow();
    assert.deepEqual(workflow.permissions, {
      actions: "write",
      contents: "write",
      "pull-requests": "write",
    });
    assert.deepEqual(Object.keys(workflow.on).sort(), ["workflow_dispatch", "workflow_run"]);
    const source = await readFile(workflowPath, "utf8");
    assert.doesNotMatch(source, /NODE_AUTH_TOKEN|NPM_TOKEN|npm publish|release:stage/u);
  });

  it("reconciles one release branch through exact plan approval and hands off one tag", async () => {
    const workflow = await readWorkflow();
    assert.equal(workflow.jobs.reconcile["timeout-minutes"], 30);
    const steps = workflow.jobs.reconcile.steps;
    const install = steps.find(({ name }) => name === "Install dependencies");
    const completion = steps.find(({ name }) => name === "Check source release completion");
    const prepareStep = steps.find(({ id }) => id === "prepare");
    assert.equal(
      prepareStep.run,
      "node scripts/release/commands/reconcile-release-workflow.mjs candidate",
    );
    const prepare = {
      run: [
        await readFile(
          resolve(import.meta.dirname, "../lib/reconcile-release-candidate.sh"),
          "utf8",
        ),
        await readFile(
          resolve(import.meta.dirname, "../lib/release-preparation-commit.sh"),
          "utf8",
        ),
      ].join("\n"),
    };
    assert.equal(install.run, "pnpm install --frozen-lockfile");
    assert.equal(completion.if, "steps.admission.outputs.status == 'ready'");
    assert.match(completion.run, /release:completion:check --base/u);
    assert.match(completion.run, /RELEASE_SOURCE_SHA/u);
    assert.match(prepare.run, /pnpm release:prepare --json/u);
    assert.match(prepare.run, /git switch -C lervo\/release-cli "\$\{RELEASE_SOURCE_SHA\}"/u);
    assert.match(prepare.run, /git branch --set-upstream-to=origin\/main lervo\/release-cli/u);
    assert.match(
      prepare.run,
      /test "\$\(git merge-base HEAD '@\{upstream\}'\)" = "\$\{RELEASE_SOURCE_SHA\}"/u,
    );
    assert.match(prepare.run, /pnpm release:prepare --apply --approval "\$\{plan_id\}" --json/u);
    assert.doesNotMatch(prepare.run, /pnpm check/u);
    assert.match(prepare.run, /pnpm release:manifest:check/u);
    assert.match(prepare.run, /pnpm release:sbom:check/u);
    assert.match(prepare.run, /pnpm release:completion:check --base/u);
    assert.match(prepare.run, /check-release-ci\.mjs/u);
    assert.match(
      prepare.run,
      /git push --force-with-lease="refs\/heads\/lervo\/release-cli:\$\{previous_sha\}"/u,
    );
    assert.doesNotMatch(prepare.run, /-F force=true|git push --force /u);
    assert.match(prepare.run, /gh pr list .*--state open/u);
    assert.match(prepare.run, /gh pr create .*--body-file "\$\{body_file\}"/u);
    assert.match(prepare.run, /gh pr edit .*--body-file "\$\{body_file\}"/u);
    assert.match(prepare.run, /render-release-pr\.mjs/u);
    assert.match(prepare.run, /gh workflow run "\$\{workflow\}" .*-f expected_sha="\$\{commit\}"/u);
    assert.match(
      prepare.run,
      /release_dispatch_once code-quality\.yml "\$\{branch\}" "\$\{commit\}" -f base_sha="\$\{base\}"/u,
    );
    assert.match(
      prepare.run,
      /release_dispatch_once cli-release-matrix\.yml "\$\{branch\}" "\$\{commit\}"\n/u,
    );
    assert.match(
      prepare.run,
      /release_verification_dispatch lervo\/release-cli "\$\{release_commit\}" "\$\{RELEASE_SOURCE_SHA\}"/u,
    );
    const body = renderReleasePrBody({
      repository: "owner/repo",
      sourceRevision: "a".repeat(40),
      releaseRevision: "b".repeat(40),
      planId: `relprep_${"c".repeat(24)}`,
      runId: 7,
    });
    for (const heading of [
      "Summary",
      "Scope and authority",
      "Contract and architecture",
      "Release impact",
      "Verification",
      "Knowledge and documentation",
      "Risk and recovery",
      "Checklist",
    ])
      assert.match(body, new RegExp(`^## ${heading}$`, "mu"));
    assert.doesNotMatch(prepare.run, /CHANGELOG\.md/u);
    const tagStep = steps.find(({ name }) => name === "Create and push the exact annotated tag");
    assert.equal(tagStep.run, "node scripts/release/commands/reconcile-release-workflow.mjs tag");
    const tag = {
      ...tagStep,
      run: await readFile(resolve(import.meta.dirname, "../lib/reconcile-release-tag.sh"), "utf8"),
    };
    assert.equal(
      tag.if,
      "steps.admission.outputs.status == 'ready' && steps.prepare.outputs.disposition == 'tag_check'",
    );
    assert.ok(tag.run.indexOf("check-release-ci.mjs --full") < tag.run.indexOf("pnpm release:tag"));
    assert.match(tag.run, /git config user\.name 'lervo-release\[bot\]'/u);
    assert.match(
      tag.run,
      /git config user\.email 'lervo-release\[bot\]@users\.noreply\.github\.com'/u,
    );
    assert.match(
      tag.run,
      /plan="\$\(node scripts\/release\/commands\/tag-cli-release\.mjs --json \|\| true\)"/u,
    );
    assert.doesNotMatch(tag.run, /plan="\$\(pnpm release:tag --json/u);
    assert.match(tag.run, /pnpm release:tag --apply --approval "\$\{plan_id\}" --json/u);
    assert.match(tag.run, /git push origin "\$\{tag\}"/u);
    assert.equal(workflow.env.GH_TOKEN, "${{ github.token }}");
    assert.match(tag.run, /actions\/workflows\/cli-release-matrix\.yml\/runs/u);
    assert.match(tag.run, /select\(\.head_sha == \$sha\)/u);
    assert.match(tag.run, /gh workflow run cli-release-matrix\.yml --ref "\$\{tag\}"/u);
  });
});

it("admits only same-repository successful push evidence and serializes effects", async () => {
  const workflow = await readWorkflow();
  assert.deepEqual(workflow.on.workflow_run, {
    workflows: ["Code quality"],
    branches: ["main"],
    types: ["completed"],
  });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.match(workflow.jobs.reconcile.if, /head_repository.full_name == github.repository/u);
  assert.match(workflow.jobs.reconcile.if, /workflow_run.event == 'push'/u);
  assert.ok(
    workflow.jobs.reconcile.steps.some(
      ({ run }) => run === "node scripts/release/commands/check-release-ci.mjs --plan",
    ),
  );
});

it("stops candidate publication when current-main admission fails after generation", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-release-ci-stop-"));
  try {
    await mkdir(resolve(root, "bin"));
    await mkdir(resolve(root, ".changes"));
    await writeFile(resolve(root, ".changes/fixture.yaml"), "pending fixture");
    const fakes = {
      git: `#!/bin/bash
printf '%s\\n' "$*" >>"$CI_FIXTURE_TRACE"
case "$*" in
  'merge-base HEAD @{upstream}') echo "$RELEASE_SOURCE_SHA" ;;
  'rev-parse HEAD') echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ;;
  'diff --name-only '*) echo apps/cli/package.json ;;
esac
`,
      pnpm: `#!/bin/bash
if [ "$*" = 'release:prepare --json' ]; then
  echo '{"planId":"relprep_cccccccccccccccccccccccc"}'
fi
`,
      node: `#!/bin/bash
if [ "$1" = 'scripts/release/commands/check-release-ci.mjs' ]; then
  echo main_admission_blocked >>"$CI_FIXTURE_TRACE"
  exit 1
fi
if [ "$1" = 'scripts/release/commands/render-release-pr.mjs' ]; then echo '## Summary'; exit 0; fi
echo unexpected_node >&2
exit 2
`,
      gh: `#!/bin/bash
if [ "$1 $2" = 'pr list' ]; then exit 0; fi
echo unexpected_remote_write >>"$CI_FIXTURE_TRACE"
exit 2
`,
    };
    for (const [name, content] of Object.entries(fakes)) {
      const path = resolve(root, "bin", name);
      await writeFile(path, content);
      await chmod(path, 0o755);
    }
    const trace = resolve(root, "effects.log");
    const result = spawnSync(
      "bash",
      [resolve(import.meta.dirname, "../lib/reconcile-release-candidate.sh")],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${root}/bin:${process.env.PATH}`,
          RELEASE_SOURCE_SHA: "a".repeat(40),
          RUNNER_TEMP: root,
          CI_FIXTURE_TRACE: trace,
        },
        timeout: 5000,
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1, result.stderr);
    const effects = await readFile(trace, "utf8");
    assert.match(effects, /commit /u);
    assert.match(effects, /main_admission_blocked/u);
    assert.doesNotMatch(effects, /^push |unexpected_remote_write/mu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
