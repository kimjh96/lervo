import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { loadReleaseIntents, ReleaseIntentError } from "./release-intent.mjs";

const execFile = promisify(execFileCallback);

async function git(repositoryRoot, args) {
  const result = await execFile("git", args, { cwd: repositoryRoot });
  return result.stdout.trim();
}

async function workspaceCatalog(repositoryRoot) {
  const result = new Map();
  for (const parent of ["apps", "packages"]) {
    for (const entry of await readdir(resolve(repositoryRoot, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = `${parent}/${entry.name}`;
      try {
        const manifest = JSON.parse(
          await readFile(resolve(repositoryRoot, directory, "package.json"), "utf8"),
        );
        if (typeof manifest.name === "string") result.set(manifest.name, { directory, manifest });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return result;
}

function workspaceClosure(catalog, seeds) {
  const selected = new Set();
  const pending = [...seeds];
  while (pending.length > 0) {
    const name = pending.pop();
    if (selected.has(name)) continue;
    const entry = catalog.get(name);
    if (entry === undefined) continue;
    selected.add(name);
    for (const dependencyName of Object.keys(entry.manifest.dependencies ?? {})) {
      if (catalog.has(dependencyName)) pending.push(dependencyName);
    }
  }
  return [...selected].map((name) => catalog.get(name).directory);
}

function releasedToolingPath(path) {
  return (
    [
      "scripts/distribution/render-runtime-service.mjs",
      "scripts/distribution/manage-runtime-service.mjs",
      "scripts/distribution/lib/runtime-service-management.mjs",
      "scripts/distribution/lib/node-cli-configuration-transition.mjs",
      "scripts/distribution/build-hub-runtime-distribution.mjs",
      "scripts/distribution/check-hub-runtime-distribution.mjs",
      "scripts/distribution/install-hub-runtime-distribution.mjs",
      "scripts/distribution/verify-hub-runtime-distribution.mjs",
      "scripts/distribution/build-node-runtime-distribution.mjs",
      "scripts/distribution/check-node-runtime-distribution.mjs",
      "scripts/distribution/install-node-runtime-distribution.mjs",
      "scripts/distribution/verify-node-runtime-distribution.mjs",
      "scripts/distribution/lib/hub-runtime-distribution.mjs",
      "scripts/distribution/lib/node-runtime-distribution.mjs",
      "scripts/distribution/lib/product-release-version.mjs",
      "packages/filesystem-durability/scripts/build-native.mjs",
      "scripts/shared/native-file-sync-artifact.mjs",
      "scripts/shared/native-file-sync-contract.mjs",
      "scripts/distribution/native-file-sync-transfer.mjs",
      "scripts/distribution/lib/native-file-sync-transfer.mjs",
      "packages/schemas/scripts/compile-validators.mjs",
      "packages/schemas/scripts/primitive-enum-keyword.mjs",
      "packages/schemas/scripts/generate-validators.mjs",
      "scripts/shared/schema-validator-artifact.mjs",
      "scripts/shared/schema-validator-contract.mjs",
    ].includes(path) ||
    path.startsWith("apps/hub/assets/") ||
    path.startsWith("packages/filesystem-durability/native/")
  );
}

function exempt(path) {
  return (
    path.startsWith("docs/") ||
    path.startsWith(".changes/") ||
    path.includes("/test/") ||
    /(?:^|\/)test\.[cm]?[jt]s$/u.test(path) ||
    /\.test\.[cm]?[jt]s$/u.test(path) ||
    [
      "scripts/release/commands/create-release-intent.mjs",
      "scripts/release/commands/check-release-intent.mjs",
      "scripts/release/commands/prepare-cli-release.mjs",
      "scripts/release/commands/check-cli-release-notes.mjs",
      "scripts/release/commands/tag-cli-release.mjs",
      "scripts/release/lib/release-intent.mjs",
      "scripts/release/lib/release-intent-check.mjs",
      "scripts/release/lib/release-preparation.mjs",
      "scripts/release/lib/release-notes.mjs",
      "scripts/release/lib/release-tag.mjs",
      ".github/workflows/release-preparation.yml",
      ".github/workflows/cli-release-matrix.yml",
    ].includes(path)
  );
}

export async function inspectReleaseIntent(input) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const intents = await loadReleaseIntents(repositoryRoot);
  const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "apps/cli/release-artifact-manifest.json"), "utf8"),
  );
  const bundledNames = new Set(
    manifest.bundle.workspacePackages.map((coordinate) =>
      coordinate.slice(0, coordinate.lastIndexOf("@")),
    ),
  );
  const catalog = await workspaceCatalog(repositoryRoot);
  const releaseArtifactDirectories = workspaceClosure(catalog, [
    ...bundledNames,
    "@lervo/hub-runtime",
    "@lervo/node-runtime",
    "@lervo/node-runtime-dependencies",
  ]);
  const changedSource = input.changedPaths
    ? [...input.changedPaths]
    : (
        await git(
          repositoryRoot,
          input.baseRevision
            ? ["diff", "--name-only", `${input.baseRevision}...HEAD`]
            : ["diff", "--name-only", "HEAD"],
        )
      ).split("\n");
  const changedPaths = changedSource.filter(Boolean).toSorted();
  const relevantIntents = input.baseRevision
    ? intents.filter((intent) => changedPaths.includes(intent.path))
    : intents;
  const publishablePaths = changedPaths.filter((path) => {
    if (exempt(path)) return false;
    if (releasedToolingPath(path)) return true;
    if (path.startsWith("apps/cli/src/") || path === "apps/cli/package.json") return true;
    return releaseArtifactDirectories.some(
      (directory) => path.startsWith(`${directory}/src/`) || path === `${directory}/package.json`,
    );
  });
  const diagnostics = [];
  if (publishablePaths.length > 0 && relevantIntents.length === 0)
    diagnostics.push("missing_release_intent");
  if (publishablePaths.length === 0 && relevantIntents.length > 0)
    diagnostics.push("unnecessary_release_intent");
  let breakingEvidence = false;
  if (input.baseRevision) {
    const messages = await git(repositoryRoot, [
      "log",
      "--format=%s%n%b",
      `${input.baseRevision}..HEAD`,
    ]);
    breakingEvidence = /(?:^[a-z]+(?:\([^)]*\))?!:|^BREAKING CHANGE:)/mu.test(messages);
  }
  if (breakingEvidence && !relevantIntents.some((intent) => intent.impact === "major"))
    diagnostics.push("breaking_evidence_requires_major_intent");
  return {
    schemaVersion: 1,
    inspectionKind: "cli_release_intent",
    valid: diagnostics.length === 0,
    publicPackage: "@lervo/cli",
    changedPathCount: changedPaths.length,
    publishablePathCount: publishablePaths.length,
    publishablePathDigests: publishablePaths.map(
      (path) =>
        // Paths remain local to the check output only as opaque digests.
        `sha256:${createHash("sha256").update(path).digest("hex")}`,
    ),
    intentIds: relevantIntents.map((intent) => intent.intentId),
    impacts: relevantIntents.map((intent) => intent.impact),
    breakingEvidence,
    diagnostics,
    exemptions: [
      "tests",
      "internal_refactor_outside_release_artifact_closures",
      "documentation",
      "release_management",
    ],
  };
}

export { ReleaseIntentError };
