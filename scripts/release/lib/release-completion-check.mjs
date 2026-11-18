import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { parse } from "yaml";

import { inspectReleaseIntent } from "./release-intent-check.mjs";
import { loadReleaseIntents, releaseDigest, validateReleaseIntent } from "./release-intent.mjs";
import { nextCliVersion } from "./release-preparation.mjs";
import { currentReleaseNotesPath, renderCurrentReleaseNotes } from "./release-notes.mjs";

const execFile = promisify(execFileCallback);
const maximumComparisonCommits = 512;
const maximumReviewedIntents = 128;
const impactOrder = { patch: 0, minor: 1, major: 2 };

async function git(repositoryRoot, args) {
  const result = await execFile("git", args, { cwd: repositoryRoot, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}

async function optionalGit(repositoryRoot, args) {
  try {
    return await git(repositoryRoot, args);
  } catch {
    return null;
  }
}

function lines(value) {
  return value === null || value === "" ? [] : value.split("\n").filter(Boolean);
}

async function exactCommit(repositoryRoot, revision) {
  const commit = await optionalGit(repositoryRoot, [
    "rev-parse",
    "--verify",
    `${revision}^{commit}`,
  ]);
  if (commit === null || !/^[a-f0-9]{40,64}$/u.test(commit))
    throw new Error("Release completion requires a valid Git base revision.");
  return commit;
}

async function automaticBase(repositoryRoot) {
  const upstream = await optionalGit(repositoryRoot, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  if (upstream !== null) {
    const base = await optionalGit(repositoryRoot, ["merge-base", "HEAD", upstream]);
    const head = await git(repositoryRoot, ["rev-parse", "HEAD"]);
    if (base !== null && base !== head) return { revision: base, source: "upstream_merge_base" };
  }
  const tag = await optionalGit(repositoryRoot, [
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    "v[0-9]*",
  ]);
  if (tag === null) return { revision: null, source: "worktree" };
  const revision = await exactCommit(repositoryRoot, tag);
  const head = await git(repositoryRoot, ["rev-parse", "HEAD"]);
  return revision === head
    ? { revision: null, source: "worktree" }
    : { revision, source: "latest_version_tag" };
}

export async function resolveReleaseCompletionComparison(input) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const selected =
    input.baseRevision === undefined
      ? await automaticBase(repositoryRoot)
      : {
          revision: await exactCommit(repositoryRoot, input.baseRevision),
          source: "explicit",
        };
  const changed = new Set();
  if (selected.revision !== null) {
    for (const path of lines(
      await git(repositoryRoot, ["diff", "--name-only", `${selected.revision}...HEAD`]),
    ))
      changed.add(path);
  }
  for (const path of lines(await git(repositoryRoot, ["diff", "--name-only", "HEAD"])))
    changed.add(path);
  for (const path of lines(
    await git(repositoryRoot, ["ls-files", "--others", "--exclude-standard"]),
  ))
    changed.add(path);
  return {
    baseRevision: selected.revision,
    baseSource: selected.source,
    changedPaths: [...changed].toSorted(),
  };
}

async function intentFromGit(repositoryRoot, revision, path) {
  const source = await git(repositoryRoot, ["show", `${revision}:${path}`]);
  const filename = path.slice(path.lastIndexOf("/") + 1);
  return validateReleaseIntent(parse(source), filename);
}

const intentPathPattern = /^\.changes\/relint_[a-f0-9]{24}\.yaml$/u;

async function changedReleaseEntries(repositoryRoot, commit) {
  return lines(
    await git(repositoryRoot, [
      "diff-tree",
      "--no-commit-id",
      "--name-status",
      "-r",
      commit,
      "--",
      ".changes",
    ]),
  ).map((entry) => {
    const separator = entry.indexOf("\t");
    return { status: entry.slice(0, separator), path: entry.slice(separator + 1) };
  });
}

// Release preparation writes the current release note and deletes every pending intent in one
// commit. Any other intent deletion withdraws or replaces that intent before review completes.
function consumesIntents(entries) {
  return (
    entries.some((entry) => entry.status === "D" && intentPathPattern.test(entry.path)) &&
    entries.some(
      (entry) => ["A", "M"].includes(entry.status) && entry.path === currentReleaseNotesPath,
    )
  );
}

async function reviewedIntentsFromHistory(repositoryRoot, baseRevision) {
  const discovered = new Map();
  const basePaths = lines(
    await optionalGit(repositoryRoot, ["ls-tree", "-r", "--name-only", baseRevision, ".changes"]),
  ).filter((path) => intentPathPattern.test(path));
  for (const path of basePaths)
    discovered.set(path, await intentFromGit(repositoryRoot, baseRevision, path));
  const commits = lines(
    await git(repositoryRoot, ["rev-list", "--topo-order", "--reverse", `${baseRevision}..HEAD`]),
  );
  if (commits.length > maximumComparisonCommits)
    throw new Error(
      `Release completion comparison exceeds ${maximumComparisonCommits} commits; provide a newer base revision.`,
    );
  for (const commit of commits) {
    const entries = await changedReleaseEntries(repositoryRoot, commit);
    const consumed = consumesIntents(entries);
    for (const { status, path } of entries.filter((entry) => intentPathPattern.test(entry.path))) {
      if (status === "A") discovered.set(path, await intentFromGit(repositoryRoot, commit, path));
      else if (status === "D" && !consumed) discovered.delete(path);
      if (discovered.size > maximumReviewedIntents)
        throw new Error(
          `Reviewed release intent exceeds the bounded limit of ${maximumReviewedIntents}.`,
        );
    }
  }
  return [...discovered.values()].toSorted((left, right) =>
    left.intentId.localeCompare(right.intentId),
  );
}

function highestImpact(intents) {
  return intents.reduce(
    (current, intent) =>
      impactOrder[intent.impact] > impactOrder[current] ? intent.impact : current,
    "patch",
  );
}

async function jsonFile(repositoryRoot, path) {
  return JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));
}

async function inspectPreparedRelease(repositoryRoot, baseRevision, breakingEvidence) {
  const currentIntents = await loadReleaseIntents(repositoryRoot);
  if (currentIntents.length > 0) return { valid: false, diagnostic: "release_intent_not_consumed" };
  const intents = await reviewedIntentsFromHistory(repositoryRoot, baseRevision);
  if (intents.length === 0) return { valid: false, diagnostic: "reviewed_release_intent_missing" };
  if (breakingEvidence && !intents.some((intent) => intent.impact === "major"))
    return { valid: false, diagnostic: "breaking_evidence_requires_major_intent" };
  const basePackage = JSON.parse(
    await git(repositoryRoot, ["show", `${baseRevision}:apps/cli/package.json`]),
  );
  const currentPackage = await jsonFile(repositoryRoot, "apps/cli/package.json");
  const impact = highestImpact(intents);
  const expectedVersion = nextCliVersion(basePackage.version, impact);
  if (currentPackage.version !== expectedVersion)
    return { valid: false, diagnostic: "prepared_release_version_mismatch" };
  const expectedNotes = renderCurrentReleaseNotes(expectedVersion, intents);
  const currentNotes = await readFile(resolve(repositoryRoot, currentReleaseNotesPath), "utf8");
  if (currentNotes !== expectedNotes)
    return { valid: false, diagnostic: "prepared_release_notes_mismatch" };
  const manifest = await jsonFile(repositoryRoot, "apps/cli/release-artifact-manifest.json");
  const sbom = await jsonFile(repositoryRoot, "apps/cli/release-sbom.cdx.json");
  if (
    manifest.artifact?.version !== expectedVersion ||
    sbom.metadata?.component?.version !== expectedVersion
  )
    return { valid: false, diagnostic: "prepared_release_metadata_mismatch" };
  return {
    valid: true,
    impact,
    version: expectedVersion,
    intentIds: intents.map((intent) => intent.intentId),
  };
}

export async function inspectReleaseCompletion(input) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const comparison = await resolveReleaseCompletionComparison(input);
  const intent = await inspectReleaseIntent({
    repositoryRoot,
    changedPaths: comparison.changedPaths,
    ...(comparison.baseRevision === null ? {} : { baseRevision: comparison.baseRevision }),
  });
  const publicComparison = {
    baseRevision: comparison.baseRevision,
    baseSource: comparison.baseSource,
    changedPathCount: comparison.changedPaths.length,
    changedPathSetDigest: releaseDigest(comparison.changedPaths),
  };
  if (intent.valid)
    return {
      schemaVersion: 1,
      inspectionKind: "cli_release_completion",
      valid: true,
      disposition: intent.intentIds.length > 0 ? "intent_pending" : "not_required",
      comparison: publicComparison,
      releaseIntent: intent,
      preparedRelease: null,
      diagnostics: [],
    };
  const eligibleForPrepared = intent.diagnostics.every((diagnostic) =>
    ["missing_release_intent", "breaking_evidence_requires_major_intent"].includes(diagnostic),
  );
  const preparedRelease =
    eligibleForPrepared && comparison.baseRevision !== null
      ? await inspectPreparedRelease(
          repositoryRoot,
          comparison.baseRevision,
          intent.breakingEvidence,
        )
      : null;
  const valid = preparedRelease?.valid === true;
  return {
    schemaVersion: 1,
    inspectionKind: "cli_release_completion",
    valid,
    disposition: valid ? "release_prepared" : "blocked",
    comparison: publicComparison,
    releaseIntent: intent,
    preparedRelease,
    diagnostics: valid
      ? []
      : [
          ...intent.diagnostics,
          ...(preparedRelease === null || preparedRelease.valid
            ? []
            : [preparedRelease.diagnostic]),
        ],
  };
}
