import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { inspectReleaseIntent } from "../lib/release-intent-check.mjs";
import { releaseDigest } from "../lib/release-intent.mjs";

const roots = [];
const execFile = promisify(execFileCallback);
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture(withIntent) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-release-intent-check-"));
  roots.push(root);
  for (const directory of [
    "apps/cli",
    "apps/hub-runtime",
    "apps/private-app",
    "packages/bundled",
    "packages/runtime-shared",
    ".changes",
  ]) {
    await mkdir(resolve(root, directory), { recursive: true });
  }
  await writeFile(
    resolve(root, "apps/cli/release-artifact-manifest.json"),
    JSON.stringify({ bundle: { workspacePackages: ["@lervo/bundled@0.1.0"] } }),
  );
  await writeFile(
    resolve(root, "apps/cli/package.json"),
    JSON.stringify({ name: "@lervo/cli", version: "0.1.0", private: false }),
  );
  await writeFile(
    resolve(root, "apps/private-app/package.json"),
    JSON.stringify({ name: "@lervo/private-app", version: "0.1.0", private: true }),
  );
  await writeFile(
    resolve(root, "apps/hub-runtime/package.json"),
    JSON.stringify({
      name: "@lervo/hub-runtime",
      version: "0.1.0",
      private: true,
      dependencies: { "@lervo/runtime-shared": "workspace:*" },
    }),
  );
  await writeFile(
    resolve(root, "packages/bundled/package.json"),
    JSON.stringify({ name: "@lervo/bundled", version: "0.1.0", private: true }),
  );
  await writeFile(
    resolve(root, "packages/runtime-shared/package.json"),
    JSON.stringify({ name: "@lervo/runtime-shared", version: "0.1.0", private: true }),
  );
  if (withIntent) {
    await writeIntent(root, "patch", "Correct public CLI behavior with bounded diagnostics.");
  }
  return root;
}

async function writeIntent(root, impact, summary) {
  const identity = { package: "@lervo/cli", impact, summary };
  const id = `relint_${releaseDigest(identity).slice("sha256:".length, "sha256:".length + 24)}`;
  await writeFile(
    resolve(root, `.changes/${id}.yaml`),
    `schemaVersion: 1\nintentId: ${id}\npackage: "${identity.package}"\nimpact: ${impact}\nsummary: ${summary}\n`,
  );
  return id;
}

describe("release intent change classification", () => {
  it.each([
    "packages/filesystem-durability/native/binding.c",
    "packages/filesystem-durability/native/sync-group.c",
    "packages/filesystem-durability/native/sync-group.h",
    "packages/filesystem-durability/scripts/build-native.mjs",
    "packages/cas/native/binding.c",
    "packages/cas/native/cas-io.c",
    "packages/cas/native/cas-io.h",
    "packages/cas/scripts/build-native.mjs",
    "packages/cas/scripts/build-native-artifact.mjs",
    "scripts/shared/native-cas-contract.mjs",
    "scripts/shared/native-cas-artifact.mjs",
    "scripts/shared/native-addon-contract.mjs",
    "scripts/shared/native-addon-artifact.mjs",
    "scripts/shared/native-runtime-artifact.mjs",
    "scripts/shared/native-runtime-contract.mjs",
    "apps/cli/scripts/build-bundle.mjs",
    "apps/hub-runtime/scripts/build-bundle.mjs",
    "apps/node-runtime/scripts/build-bundle.mjs",
    "scripts/distribution/lib/hub-runtime-distribution-contract.mjs",
    "scripts/distribution/lib/node-runtime-distribution-contract.mjs",
    "scripts/distribution/lib/runtime-distribution-sbom.mjs",
    "scripts/shared/cli-release-files.mjs",
    "scripts/shared/release-artifact-manifest.mjs",
    "scripts/release/lib/cli-native-components.mjs",
    "scripts/release/lib/cli-release-snapshot.mjs",
    "scripts/release/lib/cli-release-sbom.mjs",
    "scripts/distribution/native-runtime-transfer.mjs",
    "scripts/distribution/lib/native-runtime-transfer.mjs",
    "scripts/distribution/lib/native-runtime-restore.mjs",
    "scripts/distribution/lib/native-transfer-identity.mjs",
    "scripts/shared/native-file-sync-artifact.mjs",
    "scripts/shared/native-file-sync-contract.mjs",
    "scripts/distribution/native-file-sync-transfer.mjs",
    "scripts/distribution/lib/native-file-sync-transfer.mjs",
    "packages/schemas/scripts/compile-validators.mjs",
    "packages/schemas/scripts/primitive-enum-keyword.mjs",
    "packages/schemas/scripts/generate-validators.mjs",
    "scripts/shared/schema-validator-artifact.mjs",
    "scripts/shared/schema-validator-contract.mjs",
  ])("requires reviewed intent for generated artifact owner %s", async (path) => {
    const root = await fixture(false);
    const input = { repositoryRoot: root, changedPaths: [path] };
    await expect(inspectReleaseIntent(input)).resolves.toMatchObject({
      valid: false,
      publishablePathCount: 1,
      diagnostics: ["missing_release_intent"],
    });
    await writeIntent(root, "patch", "Bind generated runtime behavior to its reviewed artifact.");
    await expect(inspectReleaseIntent(input)).resolves.toMatchObject({
      valid: true,
      publishablePathCount: 1,
      diagnostics: [],
    });
  });

  it("requires intent for CLI and bundled-private source, but not unrelated private source", async () => {
    const without = await fixture(false);
    expect(
      await inspectReleaseIntent({
        repositoryRoot: without,
        changedPaths: ["apps/cli/src/main.ts"],
      }),
    ).toMatchObject({ valid: false, diagnostics: ["missing_release_intent"] });
    expect(
      await inspectReleaseIntent({
        repositoryRoot: without,
        changedPaths: ["packages/bundled/src/index.ts"],
      }),
    ).toMatchObject({ valid: false, publishablePathCount: 1 });

    const withIntent = await fixture(true);
    expect(
      await inspectReleaseIntent({
        repositoryRoot: withIntent,
        changedPaths: ["packages/bundled/src/index.ts"],
      }),
    ).toMatchObject({ valid: true, publishablePathCount: 1 });
    expect(
      await inspectReleaseIntent({
        repositoryRoot: withIntent,
        changedPaths: ["apps/private-app/src/index.ts"],
      }),
    ).toMatchObject({ valid: false, diagnostics: ["unnecessary_release_intent"] });
  });

  it("treats tests, documentation, and release management as exact exemptions", async () => {
    const root = await fixture(false);
    const report = await inspectReleaseIntent({
      repositoryRoot: root,
      changedPaths: [
        "apps/cli/test/main.test.ts",
        "docs/release.md",
        "scripts/release/lib/release-preparation.mjs",
      ],
    });
    expect(report).toMatchObject({ valid: true, publishablePathCount: 0 });
  });

  it("requires intent for released runtime tooling, assets, and workspace closures", async () => {
    const without = await fixture(false);
    for (const changedPath of [
      "scripts/distribution/render-runtime-service.mjs",
      "scripts/distribution/manage-runtime-service.mjs",
      "scripts/distribution/lib/runtime-service-management.mjs",
      "scripts/distribution/lib/node-cli-configuration-transition.mjs",
      "scripts/distribution/build-hub-runtime-distribution.mjs",
      "scripts/distribution/lib/product-release-version.mjs",
      "apps/hub/assets/trace.js",
      "apps/hub-runtime/src/bin.ts",
      "packages/runtime-shared/src/index.ts",
    ]) {
      await expect(
        inspectReleaseIntent({ repositoryRoot: without, changedPaths: [changedPath] }),
      ).resolves.toMatchObject({
        valid: false,
        publishablePathCount: 1,
        diagnostics: ["missing_release_intent"],
      });
    }
  });

  it("ignores unchanged pending intents when checking a later pull request", async () => {
    const root = await fixture(true);
    await execFile("git", ["init", "--initial-branch=main"], { cwd: root });
    await execFile("git", ["config", "user.name", "Lervo Test"], { cwd: root });
    await execFile("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
    await execFile("git", ["add", "."], { cwd: root });
    await execFile("git", ["commit", "-m", "test: add pending release intent"], { cwd: root });
    const base = (await execFile("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await mkdir(resolve(root, "docs"), { recursive: true });
    await writeFile(resolve(root, "docs/release.md"), "# Release\n");
    await execFile("git", ["add", "."], { cwd: root });
    await execFile("git", ["commit", "-m", "docs: document release"], { cwd: root });

    expect(await inspectReleaseIntent({ repositoryRoot: root, baseRevision: base })).toMatchObject({
      valid: true,
      publishablePathCount: 0,
      intentIds: [],
    });
  });

  it("rejects an intent whose filename is not derived from its bounded content", async () => {
    const root = await fixture(false);
    const id = "relint_aaaaaaaaaaaaaaaaaaaaaaaa";
    await writeFile(
      resolve(root, `.changes/${id}.yaml`),
      `schemaVersion: 1\nintentId: ${id}\npackage: "@lervo/cli"\nimpact: patch\nsummary: Correct public CLI behavior with bounded diagnostics.\n`,
    );
    await expect(
      inspectReleaseIntent({ repositoryRoot: root, changedPaths: ["apps/cli/src/main.ts"] }),
    ).rejects.toThrowError(expect.objectContaining({ code: "release_intent_invalid" }));
  });

  it("fails closed before a pending-intent directory can grow without bound", async () => {
    const root = await fixture(false);
    await Promise.all(
      Array.from({ length: 129 }, (_, index) =>
        writeFile(resolve(root, `.changes/pending-${index.toString().padStart(3, "0")}.yaml`), ""),
      ),
    );
    await expect(
      inspectReleaseIntent({ repositoryRoot: root, changedPaths: ["apps/cli/src/main.ts"] }),
    ).rejects.toThrowError(expect.objectContaining({ code: "release_intent_limit_exceeded" }));
  });

  it("requires reviewed major intent for Conventional Commit breaking evidence", async () => {
    const root = await fixture(false);
    await mkdir(resolve(root, "apps/cli/src"), { recursive: true });
    await writeFile(resolve(root, "apps/cli/src/main.ts"), "export const version = 1;\n");
    await execFile("git", ["init", "--initial-branch=main"], { cwd: root });
    await execFile("git", ["config", "user.name", "Lervo Test"], { cwd: root });
    await execFile("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
    await execFile("git", ["add", "."], { cwd: root });
    await execFile("git", ["commit", "-m", "test: add release fixture"], { cwd: root });
    const base = (await execFile("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await writeFile(resolve(root, "apps/cli/src/main.ts"), "export const version = 2;\n");
    await writeIntent(root, "patch", "Describe the reviewed breaking CLI behavior change.");
    await execFile("git", ["add", "."], { cwd: root });
    await execFile("git", ["commit", "-m", "feat(cli)!: change public behavior"], { cwd: root });
    const report = await inspectReleaseIntent({ repositoryRoot: root, baseRevision: base });
    expect(report).toMatchObject({
      valid: false,
      breakingEvidence: true,
      diagnostics: ["breaking_evidence_requires_major_intent"],
    });
  });
});
