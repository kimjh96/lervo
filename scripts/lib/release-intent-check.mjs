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

async function workspaceDirectories(repositoryRoot) {
  const result = new Map();
  for (const parent of ["apps", "packages"]) {
    for (const entry of await readdir(resolve(repositoryRoot, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = `${parent}/${entry.name}`;
      try {
        const manifest = JSON.parse(
          await readFile(resolve(repositoryRoot, directory, "package.json"), "utf8"),
        );
        if (typeof manifest.name === "string") result.set(manifest.name, directory);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return result;
}

function exempt(path) {
  return (
    path.startsWith("docs/") ||
    path.startsWith(".changes/") ||
    path.includes("/test/") ||
    /(?:^|\/)test\.[cm]?[jt]s$/u.test(path) ||
    /\.test\.[cm]?[jt]s$/u.test(path) ||
    path.startsWith("scripts/test/") ||
    [
      "scripts/create-release-intent.mjs",
      "scripts/check-release-intent.mjs",
      "scripts/prepare-cli-release.mjs",
      "scripts/check-cli-release-notes.mjs",
      "scripts/tag-cli-release.mjs",
      "scripts/lib/release-intent.mjs",
      "scripts/lib/release-intent-check.mjs",
      "scripts/lib/release-preparation.mjs",
      "scripts/lib/release-notes.mjs",
      "scripts/lib/release-tag.mjs",
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
  const directories = await workspaceDirectories(repositoryRoot);
  const bundledDirectories = [...bundledNames].map((name) => directories.get(name)).filter(Boolean);
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
  const publishablePaths = changedPaths.filter((path) => {
    if (exempt(path)) return false;
    if (path.startsWith("apps/cli/src/") || path === "apps/cli/package.json") return true;
    return bundledDirectories.some(
      (directory) => path.startsWith(`${directory}/src/`) || path === `${directory}/package.json`,
    );
  });
  const diagnostics = [];
  if (publishablePaths.length > 0 && intents.length === 0)
    diagnostics.push("missing_release_intent");
  if (publishablePaths.length === 0 && intents.length > 0)
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
  if (breakingEvidence && !intents.some((intent) => intent.impact === "major"))
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
    intentIds: intents.map((intent) => intent.intentId),
    impacts: intents.map((intent) => intent.impact),
    breakingEvidence,
    diagnostics,
    exemptions: [
      "tests",
      "internal_refactor_outside_cli_bundle",
      "documentation",
      "release_management",
    ],
  };
}

export { ReleaseIntentError };
