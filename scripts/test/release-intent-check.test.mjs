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
  for (const directory of ["apps/cli", "apps/private-app", "packages/bundled", ".changes"]) {
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
    resolve(root, "packages/bundled/package.json"),
    JSON.stringify({ name: "@lervo/bundled", version: "0.1.0", private: true }),
  );
  if (withIntent) {
    const identity = {
      package: "@lervo/cli",
      impact: "patch",
      summary: "Correct public CLI behavior with bounded diagnostics.",
    };
    const id = `relint_${releaseDigest(identity).slice("sha256:".length, "sha256:".length + 24)}`;
    await writeFile(
      resolve(root, `.changes/${id}.yaml`),
      `schemaVersion: 1\nintentId: ${id}\npackage: "${identity.package}"\nimpact: ${identity.impact}\nsummary: ${identity.summary}\n`,
    );
  }
  return root;
}

describe("release intent change classification", () => {
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
        "scripts/lib/release-preparation.mjs",
      ],
    });
    expect(report).toMatchObject({ valid: true, publishablePathCount: 0 });
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
    const root = await fixture(true);
    await mkdir(resolve(root, "apps/cli/src"), { recursive: true });
    await writeFile(resolve(root, "apps/cli/src/main.ts"), "export const version = 1;\n");
    await execFile("git", ["init", "--initial-branch=main"], { cwd: root });
    await execFile("git", ["config", "user.name", "Lervo Test"], { cwd: root });
    await execFile("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
    await execFile("git", ["add", "."], { cwd: root });
    await execFile("git", ["commit", "-m", "test: add release fixture"], { cwd: root });
    const base = (await execFile("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await writeFile(resolve(root, "apps/cli/src/main.ts"), "export const version = 2;\n");
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
