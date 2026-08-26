import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";
import { parse } from "yaml";

const workflowPath = resolve(
  import.meta.dirname,
  "../../.github/workflows/release-preparation.yml",
);

async function readWorkflow() {
  return parse(await readFile(workflowPath, "utf8"));
}

describe("CLI release preparation workflow", () => {
  it("has repository and pull-request authority without registry authority", async () => {
    const workflow = await readWorkflow();
    assert.deepEqual(workflow.permissions, { contents: "write", "pull-requests": "write" });
    assert.deepEqual(Object.keys(workflow.on).sort(), ["push", "workflow_dispatch"]);
    const source = await readFile(workflowPath, "utf8");
    assert.doesNotMatch(source, /NODE_AUTH_TOKEN|NPM_TOKEN|npm publish|release:stage/u);
  });

  it("reconciles one release branch through exact plan approval and hands off one tag", async () => {
    const workflow = await readWorkflow();
    const steps = workflow.jobs.reconcile.steps;
    const install = steps.find(({ name }) => name === "Install dependencies");
    const completion = steps.find(({ name }) => name === "Check direct-main release completion");
    const prepare = steps.find(({ id }) => id === "prepare");
    assert.equal(install.run, "pnpm install --frozen-lockfile");
    assert.equal(completion.if, "github.event_name == 'push'");
    assert.match(completion.run, /release:completion:check --base/u);
    assert.match(completion.run, /github\.event\.before/u);
    assert.match(prepare.run, /pnpm release:prepare --json/u);
    assert.match(prepare.run, /pnpm release:prepare --apply --approval "\$\{plan_id\}" --json/u);
    assert.match(prepare.run, /pnpm check/u);
    assert.match(prepare.run, /pnpm lervo knowledge lint --json/u);
    assert.match(
      prepare.run,
      /gh api --method PATCH "repos\/\$\{GITHUB_REPOSITORY\}\/git\/refs\/\$\{release_ref\}"/u,
    );
    assert.match(prepare.run, /-f sha="\$\{GITHUB_SHA\}" -F force=true/u);
    assert.match(prepare.run, /git switch -C lervo\/release-cli/u);
    assert.match(prepare.run, /git push origin lervo\/release-cli/u);
    assert.doesNotMatch(prepare.run, /git push --force/u);
    assert.doesNotMatch(prepare.run, /force-with-lease/u);
    assert.match(prepare.run, /gh pr list .*--state open/u);
    assert.match(prepare.run, /gh pr create .*--body-file "\$\{body_file\}"/u);
    assert.match(prepare.run, /gh pr edit .*--body-file "\$\{body_file\}"/u);
    assert.doesNotMatch(prepare.run, /gh pr view lervo\/release-cli/u);
    assert.match(prepare.run, /\[x\] Relevant tests, `pnpm quality:check`/u);
    assert.match(prepare.run, /exact release branch/u);
    assert.doesNotMatch(prepare.run, /Pending pull-request CI/u);
    assert.doesNotMatch(prepare.run, /—/u);
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
      assert.match(prepare.run, new RegExp(`^## ${heading}$`, "mu"));
    assert.doesNotMatch(prepare.run, /CHANGELOG\.md/u);
    const tag = steps.find(({ name }) => name === "Create and push the exact annotated tag");
    assert.equal(tag.if, "steps.prepare.outputs.disposition == 'tag_check'");
    assert.match(tag.run, /git config user\.name 'lervo-release\[bot\]'/u);
    assert.match(
      tag.run,
      /git config user\.email 'lervo-release\[bot\]@users\.noreply\.github\.com'/u,
    );
    assert.match(tag.run, /pnpm release:tag --apply --approval "\$\{plan_id\}" --json/u);
    assert.match(tag.run, /git push origin "\$\(jq -r '\.tag' <<<"\$\{plan\}"\)"/u);
  });
});
