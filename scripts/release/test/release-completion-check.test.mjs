import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  inspectReleaseCompletion,
  resolveReleaseCompletionComparison,
} from "../lib/release-completion-check.mjs";
import { createReleaseIntent, loadReleaseIntents } from "../lib/release-intent.mjs";
import { renderCurrentReleaseNotes } from "../lib/release-notes.mjs";

const execFile = promisify(execFileCallback);
const roots = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function git(root, ...args) {
  return (await execFile("git", args, { cwd: root })).stdout.trim();
}

async function writeJson(root, path, value) {
  await writeFile(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-release-completion-"));
  roots.push(root);
  for (const directory of ["apps/cli/src", "packages/bundled/src", ".changes"])
    await mkdir(resolve(root, directory), { recursive: true });
  await writeJson(root, "apps/cli/package.json", {
    name: "@lervo/cli",
    version: "0.2.2",
    private: false,
  });
  await writeJson(root, "apps/cli/release-artifact-manifest.json", {
    artifact: { version: "0.2.2" },
    bundle: { workspacePackages: ["@lervo/bundled@0.1.0"] },
  });
  await writeJson(root, "apps/cli/release-sbom.cdx.json", {
    metadata: { component: { version: "0.2.2" } },
  });
  await writeJson(root, "packages/bundled/package.json", {
    name: "@lervo/bundled",
    version: "0.1.0",
    private: true,
  });
  await writeFile(resolve(root, "apps/cli/src/main.ts"), "export const value = 1;\n");
  await writeFile(resolve(root, "packages/bundled/src/index.ts"), "export const bundled = 1;\n");
  await writeFile(
    resolve(root, ".changes/current-release.md"),
    '<!-- lervo-release package="@lervo/cli" version="0.2.2" schema="1" -->\n\n## What\'s changed\n\n- Previous release.\n',
  );
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.name", "Lervo Test");
  await git(root, "config", "user.email", "lervo-test@example.invalid");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "test: initialize release completion fixture");
  return { root, base: await git(root, "rev-parse", "HEAD") };
}

async function changeBundledSource(root) {
  await writeFile(resolve(root, "packages/bundled/src/index.ts"), "export const bundled = 2;\n");
}

async function prepareFixtureRelease(root, version) {
  const intents = await loadReleaseIntents(root);
  for (const path of [
    "apps/cli/package.json",
    "apps/cli/release-artifact-manifest.json",
    "apps/cli/release-sbom.cdx.json",
  ]) {
    const value = JSON.parse(await readFile(resolve(root, path), "utf8"));
    if (path.endsWith("package.json")) value.version = version;
    else if (value.artifact) value.artifact.version = version;
    else value.metadata.component.version = version;
    await writeJson(root, path, value);
  }
  await writeFile(
    resolve(root, ".changes/current-release.md"),
    renderCurrentReleaseNotes(version, intents),
  );
  for (const intent of intents) await rm(resolve(root, intent.path));
}

describe("CLI release completion", () => {
  it("checks prepared CI bytes against their source instead of an older tag", async () => {
    const { root } = await fixture();
    await git(root, "tag", "v0.2.2");
    await changeBundledSource(root);
    await createReleaseIntent(root, {
      impact: "patch",
      summary: "Correct an earlier bundled behavior before the current release.",
    });
    await git(root, "add", ".");
    await git(root, "commit", "-m", "fix: correct earlier bundled behavior");
    await prepareFixtureRelease(root, "0.2.3");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "chore(cli): prepare earlier release");
    await createReleaseIntent(root, {
      impact: "minor",
      summary: "Add the currently reviewed bundled capability for CLI users.",
    });
    await writeFile(resolve(root, "packages/bundled/src/index.ts"), "export const bundled = 3;\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "feat: add current bundled capability");
    const sourceRevision = await git(root, "rev-parse", "HEAD");
    await git(root, "remote", "add", "origin", root);
    await git(root, "update-ref", "refs/remotes/origin/main", sourceRevision);
    await git(root, "checkout", "--detach", sourceRevision);
    await prepareFixtureRelease(root, "0.3.0");

    const detached = await inspectReleaseCompletion({ repositoryRoot: root });
    expect(detached.valid).toBe(false);
    expect(detached.diagnostics).toContain("prepared_release_notes_mismatch");

    await git(root, "switch", "-C", "lervo/release-cli", sourceRevision);
    await git(root, "branch", "--set-upstream-to=origin/main", "lervo/release-cli");
    expect(await git(root, "merge-base", "HEAD", "@{upstream}")).toBe(sourceRevision);
    await git(root, "add", ".");
    await git(root, "commit", "-m", "chore(cli): prepare current release");
    await expect(inspectReleaseCompletion({ repositoryRoot: root })).resolves.toMatchObject({
      valid: true,
      disposition: "release_prepared",
      comparison: { baseRevision: sourceRevision, baseSource: "upstream_merge_base" },
      preparedRelease: { valid: true, version: "0.3.0" },
    });
  });

  it("blocks a publishable worktree change without reviewed intent", async () => {
    const { root, base } = await fixture();
    await changeBundledSource(root);

    const report = await inspectReleaseCompletion({ repositoryRoot: root, baseRevision: base });
    expect(report).toMatchObject({
      valid: false,
      disposition: "blocked",
      comparison: { changedPathCount: 1 },
      diagnostics: ["missing_release_intent", "reviewed_release_intent_missing"],
    });
    expect(JSON.stringify(report)).not.toContain("packages/bundled");
  });

  it("accepts a current intent covering publishable work", async () => {
    const { root, base } = await fixture();
    await changeBundledSource(root);
    await createReleaseIntent(root, {
      impact: "minor",
      summary: "Add a reviewed bundled capability for public CLI users.",
    });

    await expect(
      inspectReleaseCompletion({ repositoryRoot: root, baseRevision: base }),
    ).resolves.toMatchObject({ valid: true, disposition: "intent_pending", diagnostics: [] });
  });

  it("accepts only an exact prepared release backed by intent history", async () => {
    const { root, base } = await fixture();
    await changeBundledSource(root);
    await createReleaseIntent(root, {
      impact: "minor",
      summary: "Add a reviewed bundled capability for public CLI users.",
    });
    await git(root, "add", ".");
    await git(root, "commit", "-m", "feat: add bundled capability");
    const intents = await loadReleaseIntents(root);
    await writeJson(root, "apps/cli/package.json", {
      name: "@lervo/cli",
      version: "0.3.0",
      private: false,
    });
    await writeJson(root, "apps/cli/release-artifact-manifest.json", {
      artifact: { version: "0.3.0" },
      bundle: { workspacePackages: ["@lervo/bundled@0.1.0"] },
    });
    await writeJson(root, "apps/cli/release-sbom.cdx.json", {
      metadata: { component: { version: "0.3.0" } },
    });
    await writeFile(
      resolve(root, ".changes/current-release.md"),
      renderCurrentReleaseNotes("0.3.0", intents),
    );
    await rm(resolve(root, intents[0].path));
    await git(root, "add", ".");
    await git(root, "commit", "-m", "chore(cli): prepare release");

    await expect(
      inspectReleaseCompletion({ repositoryRoot: root, baseRevision: base }),
    ).resolves.toMatchObject({
      valid: true,
      disposition: "release_prepared",
      preparedRelease: { valid: true, impact: "minor", version: "0.3.0" },
    });
  });

  it("accepts a prepared feature pull request on its base and on main after the merge", async () => {
    const { root, base } = await fixture();
    await git(root, "switch", "-c", "feature");
    await changeBundledSource(root);
    await createReleaseIntent(root, {
      impact: "patch",
      summary: "Correct a bundled behavior inside the feature pull request.",
    });
    await git(root, "add", ".");
    await git(root, "commit", "-m", "fix: correct bundled behavior");
    await prepareFixtureRelease(root, "0.2.3");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "chore(cli): prepare release");
    const expected = {
      valid: true,
      disposition: "release_prepared",
      preparedRelease: { valid: true, impact: "patch", version: "0.2.3" },
    };
    await expect(
      inspectReleaseCompletion({ repositoryRoot: root, baseRevision: base }),
    ).resolves.toMatchObject(expected);

    await git(root, "switch", "main");
    await git(
      root,
      "merge",
      "--no-ff",
      "-m",
      "Merge pull request #1 from owner/feature",
      "feature",
    );
    await expect(
      inspectReleaseCompletion({ repositoryRoot: root, baseRevision: base }),
    ).resolves.toMatchObject(expected);
  });

  it("blocks a squashed intent and preparation because no reviewed intent reached history", async () => {
    const { root, base } = await fixture();
    await changeBundledSource(root);
    await createReleaseIntent(root, {
      impact: "patch",
      summary: "Correct a bundled behavior with a squashed preparation commit.",
    });
    await prepareFixtureRelease(root, "0.2.3");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "fix: correct bundled behavior and prepare release");

    await expect(
      inspectReleaseCompletion({ repositoryRoot: root, baseRevision: base }),
    ).resolves.toMatchObject({
      valid: false,
      disposition: "blocked",
      diagnostics: ["missing_release_intent", "reviewed_release_intent_missing"],
    });
  });

  it("counts only the replacement when a later commit rewrites intent before preparation", async () => {
    const { root, base } = await fixture();
    await changeBundledSource(root);
    const original = await createReleaseIntent(root, {
      impact: "patch",
      summary: "Correct a bundled behavior described by the first draft.",
    });
    await git(root, "add", ".");
    await git(root, "commit", "-m", "fix: correct bundled behavior");
    await rm(resolve(root, original.path));
    const replacement = await createReleaseIntent(root, {
      impact: "patch",
      summary: "Correct a bundled behavior described by the rewritten intent.",
    });
    await git(root, "add", ".");
    await git(root, "commit", "-m", "docs: rewrite release intent");
    await prepareFixtureRelease(root, "0.2.3");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "chore(cli): prepare release");

    await expect(
      inspectReleaseCompletion({ repositoryRoot: root, baseRevision: base }),
    ).resolves.toMatchObject({
      valid: true,
      disposition: "release_prepared",
      diagnostics: [],
      preparedRelease: { impact: "patch", intentIds: [replacement.intent.intentId] },
    });
  });

  it("drops intent withdrawn before preparation from the prepared release", async () => {
    const { root, base } = await fixture();
    await changeBundledSource(root);
    const withdrawn = await createReleaseIntent(root, {
      impact: "minor",
      summary: "Add a bundled capability that the author later withdraws.",
    });
    const kept = await createReleaseIntent(root, {
      impact: "patch",
      summary: "Correct a bundled behavior that remains in the release.",
    });
    await git(root, "add", ".");
    await git(root, "commit", "-m", "fix: correct bundled behavior");
    await rm(resolve(root, withdrawn.path));
    await git(root, "add", ".");
    await git(root, "commit", "-m", "docs: withdraw release intent");
    await prepareFixtureRelease(root, "0.2.3");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "chore(cli): prepare release");

    await expect(
      inspectReleaseCompletion({ repositoryRoot: root, baseRevision: base }),
    ).resolves.toMatchObject({
      valid: true,
      disposition: "release_prepared",
      preparedRelease: { impact: "patch", version: "0.2.3", intentIds: [kept.intent.intentId] },
    });
  });

  it("finds no reviewed intent when the only intent was withdrawn", async () => {
    const { root, base } = await fixture();
    await changeBundledSource(root);
    const withdrawn = await createReleaseIntent(root, {
      impact: "minor",
      summary: "Add a bundled capability that the author later withdraws.",
    });
    await git(root, "add", ".");
    await git(root, "commit", "-m", "feat: add bundled capability");
    await rm(resolve(root, withdrawn.path));
    await git(root, "add", ".");
    await git(root, "commit", "-m", "docs: withdraw release intent");

    await expect(
      inspectReleaseCompletion({ repositoryRoot: root, baseRevision: base }),
    ).resolves.toMatchObject({
      valid: false,
      diagnostics: ["missing_release_intent", "reviewed_release_intent_missing"],
    });
  });

  it("blocks the second of two pull requests prepared on the same version line", async () => {
    const { root, base } = await fixture();
    for (const [branch, value] of [
      ["first", 2],
      ["second", 3],
    ]) {
      await git(root, "switch", "-c", branch, base);
      await writeFile(
        resolve(root, "packages/bundled/src/index.ts"),
        `export const bundled = ${value};\n`,
      );
      await createReleaseIntent(root, {
        impact: "patch",
        summary: `Correct bundled behavior number ${value} in its own pull request.`,
      });
      await git(root, "add", ".");
      await git(root, "commit", "-m", `fix: correct bundled behavior ${value}`);
      await prepareFixtureRelease(root, "0.2.3");
      await git(root, "add", ".");
      await git(root, "commit", "-m", "chore(cli): prepare release");
    }
    await git(root, "switch", "main");
    await git(root, "merge", "--no-ff", "-m", "Merge pull request #1 from owner/first", "first");
    const firstMain = await git(root, "rev-parse", "HEAD");
    await git(root, "switch", "second");

    await expect(
      inspectReleaseCompletion({ repositoryRoot: root, baseRevision: firstMain }),
    ).resolves.toMatchObject({
      valid: false,
      diagnostics: ["missing_release_intent", "prepared_release_version_mismatch"],
    });
  });

  it("rejects a manual version bump without reviewed intent history", async () => {
    const { root, base } = await fixture();
    await changeBundledSource(root);
    const packageManifest = JSON.parse(
      await readFile(resolve(root, "apps/cli/package.json"), "utf8"),
    );
    await writeJson(root, "apps/cli/package.json", { ...packageManifest, version: "0.3.0" });
    await git(root, "add", ".");
    await git(root, "commit", "-m", "feat: bypass release intent");

    await expect(
      inspectReleaseCompletion({ repositoryRoot: root, baseRevision: base }),
    ).resolves.toMatchObject({
      valid: false,
      diagnostics: ["missing_release_intent", "reviewed_release_intent_missing"],
    });
  });

  it("uses an upstream merge base for local completion", async () => {
    const { root, base } = await fixture();
    await git(root, "remote", "add", "origin", root);
    await git(root, "update-ref", "refs/remotes/origin/main", base);
    await git(root, "branch", "--set-upstream-to=origin/main", "main");
    await changeBundledSource(root);
    await createReleaseIntent(root, {
      impact: "patch",
      summary: "Correct local release completion comparison behavior.",
    });
    await git(root, "add", ".");
    await git(root, "commit", "-m", "fix: bind local completion base");

    await expect(
      resolveReleaseCompletionComparison({ repositoryRoot: root }),
    ).resolves.toMatchObject({ baseRevision: base, baseSource: "upstream_merge_base" });
    await expect(inspectReleaseCompletion({ repositoryRoot: root })).resolves.toMatchObject({
      valid: true,
      disposition: "intent_pending",
    });
  });
});
