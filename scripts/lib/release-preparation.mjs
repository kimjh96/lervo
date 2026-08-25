import { execFile as execFileCallback } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { loadReleaseIntents, releaseDigest, ReleaseIntentError } from "./release-intent.mjs";

const execFile = promisify(execFileCallback);
const impactOrder = { patch: 0, minor: 1, major: 2 };

export class ReleasePreparationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleasePreparationError";
    this.code = code;
  }
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (match === null)
    throw new ReleasePreparationError("release_version_invalid", "CLI version is not semantic.");
  return match.slice(1).map(Number);
}

export function nextCliVersion(version, impact) {
  const [major, minor, patch] = parseVersion(version);
  if (major === 0) {
    if (impact === "patch") return `0.${minor}.${patch + 1}`;
    return `0.${minor + 1}.0`;
  }
  if (impact === "major") return `${major + 1}.0.0`;
  if (impact === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function highestImpact(intents) {
  return intents.reduce(
    (highest, intent) =>
      impactOrder[intent.impact] > impactOrder[highest] ? intent.impact : highest,
    "patch",
  );
}

function releaseEntry(version, date, intents) {
  return [
    `## ${version} - ${date}`,
    "",
    ...intents
      .toSorted(
        (left, right) =>
          left.summary.localeCompare(right.summary) || left.intentId.localeCompare(right.intentId),
      )
      .map((intent) => `- ${intent.summary}`),
    "",
  ].join("\n");
}

function desiredChangelog(current, version, date, intents) {
  const heading = "# Changelog\n\n";
  const body =
    current === null ? "" : current.startsWith(heading) ? current.slice(heading.length) : null;
  if (body === null)
    throw new ReleasePreparationError(
      "release_changelog_invalid",
      "CHANGELOG.md does not use the canonical heading.",
    );
  if (body.includes(`## ${version} - `))
    throw new ReleasePreparationError(
      "release_changelog_conflict",
      `CHANGELOG.md already contains version ${version}.`,
    );
  return `${heading}${releaseEntry(version, date, intents)}${body}`;
}

async function optionalText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function currentRevision(repositoryRoot) {
  const result = await execFile("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot });
  return result.stdout.trim();
}

async function revisionDate(repositoryRoot, sourceRevision) {
  const result = await execFile("git", ["show", "-s", "--format=%cs", sourceRevision], {
    cwd: repositoryRoot,
  });
  return result.stdout.trim();
}

export async function createReleasePreparationPlan(input) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const intents = await loadReleaseIntents(repositoryRoot);
  if (intents.length === 0)
    throw new ReleasePreparationError(
      "release_intent_missing",
      "No pending @lervo/cli release intent exists.",
    );
  const sourceRevision = input.sourceRevision ?? (await currentRevision(repositoryRoot));
  if (!/^[a-f0-9]{40,64}$/u.test(sourceRevision))
    throw new ReleasePreparationError(
      "release_source_revision_invalid",
      "Release preparation requires an exact source revision.",
    );
  const releaseDate = input.releaseDate ?? (await revisionDate(repositoryRoot, sourceRevision));
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(releaseDate))
    throw new ReleasePreparationError(
      "release_date_invalid",
      "Release preparation requires YYYY-MM-DD.",
    );
  const packagePath = resolve(repositoryRoot, "apps/cli/package.json");
  const packageSource = await readFile(packagePath, "utf8");
  const packageManifest = JSON.parse(packageSource);
  if (packageManifest.name !== "@lervo/cli" || packageManifest.private !== false)
    throw new ReleasePreparationError(
      "release_public_package_invalid",
      "Only the public @lervo/cli package may be versioned.",
    );
  const impact = highestImpact(intents);
  const nextVersion = nextCliVersion(packageManifest.version, impact);
  const desiredPackage = `${JSON.stringify({ ...packageManifest, version: nextVersion }, null, 2)}\n`;
  const changelogPath = resolve(repositoryRoot, "CHANGELOG.md");
  const changelogSource = await optionalText(changelogPath);
  const changelog = desiredChangelog(changelogSource, nextVersion, releaseDate, intents);
  const operations = [
    {
      path: "apps/cli/package.json",
      action: "update",
      expectedHash: releaseDigest(packageSource),
      desiredHash: releaseDigest(desiredPackage),
      content: desiredPackage,
      owner: "release_preparation",
    },
    {
      path: "CHANGELOG.md",
      action: changelogSource === null ? "create" : "update",
      expectedHash: changelogSource === null ? null : releaseDigest(changelogSource),
      desiredHash: releaseDigest(changelog),
      content: changelog,
      owner: "release_preparation",
    },
    ...intents.map((intent) => ({
      path: intent.path,
      action: "delete",
      expectedHash: intent.contentHash,
      desiredHash: null,
      owner: "release_intent",
    })),
  ];
  const ownedCommands = [
    ["pnpm", ["install", "--lockfile-only", "--frozen-lockfile"]],
    ["pnpm", ["build"]],
    ["pnpm", ["release:manifest:update"]],
    ["pnpm", ["release:sbom:update"]],
  ];
  const bindings = {
    sourceRevision,
    currentVersion: packageManifest.version,
    nextVersion,
    impact,
    releaseDate,
    intentIds: intents.map((intent) => intent.intentId),
    intentDigest: releaseDigest(intents.map(({ path, contentHash }) => ({ path, contentHash }))),
    operations,
    ownedCommands,
  };
  return {
    schemaVersion: 1,
    planKind: "cli_release_preparation",
    planId: `relprep_${releaseDigest(bindings).slice("sha256:".length, "sha256:".length + 24)}`,
    repositoryRoot,
    status: "ready",
    package: "@lervo/cli",
    ...bindings,
    authority: {
      repositoryWrite: true,
      tag: false,
      npmStageApproval: false,
      npmPublication: false,
    },
  };
}

export function publicReleasePreparationPlan(plan) {
  return {
    ...plan,
    operations: plan.operations.map(({ content: _content, ...operation }) => operation),
  };
}

async function capture(repositoryRoot, paths) {
  const captured = new Map();
  for (const path of paths) captured.set(path, await optionalText(resolve(repositoryRoot, path)));
  return captured;
}

async function restore(repositoryRoot, captured) {
  for (const [path, content] of captured) {
    const absolute = resolve(repositoryRoot, path);
    if (content === null) await rm(absolute, { force: true });
    else await writeFile(absolute, content, "utf8");
  }
}

async function applyFileOperations(plan) {
  for (const operation of plan.operations) {
    const path = resolve(plan.repositoryRoot, operation.path);
    const current = await optionalText(path);
    const currentHash = current === null ? null : releaseDigest(current);
    if (currentHash !== operation.expectedHash)
      throw new ReleasePreparationError(
        "release_plan_stale",
        `Release preparation target ${operation.path} changed after planning.`,
      );
    if (operation.action === "delete") await rm(path);
    else {
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, operation.content, "utf8");
      await rename(temporary, path);
    }
  }
}

async function validateGenerated(repositoryRoot, version) {
  const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "apps/cli/release-artifact-manifest.json"), "utf8"),
  );
  const sbom = JSON.parse(
    await readFile(resolve(repositoryRoot, "apps/cli/release-sbom.cdx.json"), "utf8"),
  );
  if (manifest.artifact?.version !== version || sbom.metadata?.component?.version !== version)
    throw new ReleasePreparationError(
      "release_generated_version_mismatch",
      "Owned release generators did not bind the prepared CLI version.",
    );
}

export async function applyReleasePreparation(input) {
  if (input.approval !== input.plan.planId)
    throw new ReleasePreparationError(
      "release_approval_invalid",
      "Release preparation approval must equal the exact plan ID.",
    );
  const current = await createReleasePreparationPlan({
    repositoryRoot: input.plan.repositoryRoot,
    releaseDate: input.plan.releaseDate,
    sourceRevision: input.plan.sourceRevision,
  });
  if (current.planId !== input.plan.planId)
    throw new ReleasePreparationError(
      "release_plan_stale",
      "Release intent or repository inputs changed after planning.",
    );
  const protectedPaths = [
    ...input.plan.operations.map((operation) => operation.path),
    "pnpm-lock.yaml",
    "apps/cli/release-artifact-manifest.json",
    "apps/cli/release-sbom.cdx.json",
  ];
  const captured = await capture(input.plan.repositoryRoot, new Set(protectedPaths));
  const runOwned =
    input.runOwned ??
    (async (command, args) => {
      await execFile(command, args, {
        cwd: input.plan.repositoryRoot,
        maxBuffer: 8 * 1024 * 1024,
      });
    });
  try {
    await applyFileOperations(input.plan);
    for (const [command, args] of input.plan.ownedCommands) await runOwned(command, args);
    await validateGenerated(input.plan.repositoryRoot, input.plan.nextVersion);
    return {
      schemaVersion: 1,
      receiptKind: "cli_release_prepared",
      planId: input.plan.planId,
      package: input.plan.package,
      version: input.plan.nextVersion,
      sourceRevision: input.plan.sourceRevision,
      consumedIntentIds: input.plan.intentIds,
      generated: {
        manifestHash: releaseDigest(
          await readFile(
            resolve(input.plan.repositoryRoot, "apps/cli/release-artifact-manifest.json"),
            "utf8",
          ),
        ),
        sbomHash: releaseDigest(
          await readFile(
            resolve(input.plan.repositoryRoot, "apps/cli/release-sbom.cdx.json"),
            "utf8",
          ),
        ),
        lockfileHash: releaseDigest(
          await readFile(resolve(input.plan.repositoryRoot, "pnpm-lock.yaml"), "utf8"),
        ),
      },
      authority: input.plan.authority,
    };
  } catch (error) {
    await restore(input.plan.repositoryRoot, captured);
    throw error instanceof ReleaseIntentError || error instanceof ReleasePreparationError
      ? error
      : new ReleasePreparationError(
          "release_preparation_failed",
          "Release preparation failed and tracked inputs were restored.",
        );
  }
}
