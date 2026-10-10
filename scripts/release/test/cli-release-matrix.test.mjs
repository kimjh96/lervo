import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { parse } from "yaml";

import { pnpmDeployFetchArgs } from "../../distribution/lib/installed-cli.mjs";

const workflowPath = resolve(
  import.meta.dirname,
  "../../../.github/workflows/cli-release-matrix.yml",
);
const gitAttributesPath = resolve(import.meta.dirname, "../../../.gitattributes");
const cliBuildScriptPath = resolve(
  import.meta.dirname,
  "../../../apps/cli/scripts/build-bundle.mjs",
);

async function readWorkflow() {
  return parse(await readFile(workflowPath, "utf8"));
}

describe("CLI release matrix workflow", () => {
  it("checks out release inputs with platform-independent line endings", async () => {
    assert.equal(await readFile(gitAttributesPath, "utf8"), "* text=auto eol=lf\n");
  });

  it("keeps provider-native code external in both packaged provider entrypoints", async () => {
    const buildScript = await readFile(cliBuildScriptPath, "utf8");
    assert.equal(
      [...buildScript.matchAll(/external: \["@anthropic-ai\/claude-agent-sdk"\]/gu)].length,
      2,
    );
  });

  it("allows only Windows to fetch an exact locked tarball missing from its local store", () => {
    assert.deepEqual(pnpmDeployFetchArgs("win32"), ["--prefer-offline"]);
    assert.deepEqual(pnpmDeployFetchArgs("darwin"), ["--offline"]);
    assert.deepEqual(pnpmDeployFetchArgs("linux"), ["--offline"]);
  });

  it("runs the packed CLI contract on all supported desktop platforms", async () => {
    const workflow = await readWorkflow();
    assert.deepEqual(Object.keys(workflow.on).sort(), [
      "pull_request",
      "push",
      "workflow_dispatch",
    ]);
    assert.deepEqual(workflow.on.push, { tags: ["v*"] });
    assert.deepEqual(workflow.permissions, { contents: "read" });
    const job = workflow.jobs["packed-cli"];
    assert.equal(
      job.if,
      "github.event_name != 'pull_request' || github.head_ref == 'lervo/release-cli'",
    );
    assert.equal(job.strategy["fail-fast"], false);
    assert.deepEqual(job.strategy.matrix.os, ["ubuntu-latest", "macos-latest", "windows-latest"]);
    assert.equal(job["timeout-minutes"], 20);
  });

  it("pins setup actions and the minimum supported Node release", async () => {
    const workflow = await readWorkflow();
    const steps = workflow.jobs["packed-cli"].steps;
    assert.deepEqual(
      steps.slice(0, 3).map(({ uses }) => uses),
      [
        "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
        "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
        "pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9",
      ],
    );
    assert.equal(steps[0].with["persist-credentials"], false);
    assert.equal(steps[1].with["node-version"], "22.13.0");
    assert.equal(steps[1].with["package-manager-cache"], false);
  });

  it("builds once and checks both the release manifest and consumer install", async () => {
    const workflow = await readWorkflow();
    const commands = workflow.jobs["packed-cli"].steps.map(({ run }) => run).filter(Boolean);
    assert.deepEqual(commands, [
      "pnpm install --frozen-lockfile",
      'node scripts/distribution/native-file-sync-transfer.mjs restore "${{ runner.temp }}/native-file-sync"',
      "pnpm build",
      "pnpm release:manifest:check",
      "pnpm release:sbom:check",
      "pnpm release:attestation:check",
      "pnpm smoke:packed-cli",
      "pnpm smoke:registry-publish",
    ]);
  });

  it("signs exact release subjects for an exact pushed or manually selected tag", async () => {
    const workflow = await readWorkflow();
    const job = workflow.jobs["attested-cli"];
    assert.equal(
      job.if,
      "github.ref_type == 'tag' && startsWith(github.ref_name, 'v') && (github.event.repository.private != true || github.event.repository.owner.type != 'User')",
    );
    assert.deepEqual(job.needs, ["packed-cli", "native-file-sync"]);
    assert.equal(job["runs-on"], "ubuntu-latest");
    assert.deepEqual(job.permissions, {
      contents: "read",
      "id-token": "write",
      attestations: "write",
      "artifact-metadata": "write",
    });
    assert.deepEqual(job.steps.map(({ uses }) => uses).filter(Boolean), [
      "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9",
      "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
      "actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d",
      "actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d",
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    ]);
    const prepare = job.steps.find(({ name }) => name === "Prepare exact release subjects");
    assert.equal(
      prepare.run,
      'pnpm release:attestation:prepare "${RUNNER_TEMP}/lervo-release" --expected-tag "${GITHUB_REF_NAME}"',
    );
    const provenance = job.steps.find(({ id }) => id === "build-attestation");
    assert.deepEqual(provenance.with["subject-path"].trim().split("\n"), [
      "${{ runner.temp }}/lervo-release/*.tgz",
      "${{ runner.temp }}/lervo-release/release-artifact-manifest.json",
      "${{ runner.temp }}/lervo-release/release-sbom.cdx.json",
    ]);
    const sbom = job.steps.find(({ id }) => id === "sbom-attestation");
    assert.equal(sbom.with["subject-path"], "${{ runner.temp }}/lervo-release/*.tgz");
    assert.equal(sbom.with["sbom-path"], "${{ runner.temp }}/lervo-release/release-sbom.cdx.json");
    const verify = job.steps.find(
      ({ name }) => name === "Verify release attestations as a consumer",
    );
    assert.deepEqual(verify.env, { GH_TOKEN: "${{ github.token }}" });
    assert.equal(
      verify.run,
      'pnpm release:attestation:verify --release-directory "${RUNNER_TEMP}/lervo-release" --repository "${GITHUB_REPOSITORY}" --tag "${GITHUB_REF_NAME}" --source-digest "${GITHUB_SHA}"',
    );
    const authorize = job.steps.find(
      ({ name }) => name === "Authorize exact npm publication coordinates",
    );
    assert.deepEqual(authorize.env, { GH_TOKEN: "${{ github.token }}" });
    assert.equal(
      authorize.run,
      'pnpm release:publication:authorize --release-directory "${RUNNER_TEMP}/lervo-release" --repository "${GITHUB_REPOSITORY}" --tag "${GITHUB_REF_NAME}" --source-digest "${GITHUB_SHA}" --dist-tag latest --output "${RUNNER_TEMP}/lervo-publication-authorization.json"',
    );
    const upload = job.steps.find(
      ({ name }) => name === "Upload release files, signed bundles, and publication authorization",
    );
    assert.ok(job.steps.indexOf(verify) < job.steps.indexOf(authorize));
    assert.ok(job.steps.indexOf(authorize) < job.steps.indexOf(upload));
    assert.deepEqual(upload.with.path.trim().split("\n"), [
      "${{ runner.temp }}/lervo-release",
      "${{ runner.temp }}/lervo-publication-authorization.json",
    ]);
  });

  it("publishes one idempotent GitHub Release from the bounded current note", async () => {
    const workflow = await readWorkflow();
    const job = workflow.jobs["github-release"];
    assert.deepEqual(job.needs, ["packed-cli", "attested-cli"]);
    assert.deepEqual(job.permissions, { contents: "write" });
    assert.match(job.if, /needs\.packed-cli\.result == 'success'/u);
    assert.match(job.if, /needs\.attested-cli\.result == 'skipped'/u);
    const verify = job.steps.find(({ name }) => name === "Verify exact current release notes");
    assert.equal(
      verify.run,
      'node scripts/release/commands/check-cli-release-notes.mjs --expected-tag "${GITHUB_REF_NAME}"',
    );
    const release = job.steps.find(({ name }) => name === "Create or reconcile the GitHub release");
    assert.deepEqual(release.env, { GH_TOKEN: "${{ github.token }}" });
    assert.match(release.run, /gh release view/u);
    assert.match(release.run, /gh release edit/u);
    assert.match(release.run, /gh release create/u);
    assert.match(
      release.run,
      /gh release edit "\$\{GITHUB_REF_NAME\}" --title "@lervo\/cli \$\{GITHUB_REF_NAME\}"/u,
    );
    assert.match(
      release.run,
      /gh release create "\$\{GITHUB_REF_NAME\}" --verify-tag --title "@lervo\/cli \$\{GITHUB_REF_NAME\}"/u,
    );
    assert.doesNotMatch(release.run, /--title "Lervo CLI /u);
    assert.match(release.run, /--notes-file \.changes\/current-release\.md/u);
  });
});
