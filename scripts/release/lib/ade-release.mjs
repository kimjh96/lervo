// ADE release preparation (ADR-0615): one version for the interface, the shell, and the session
// host, the ADE's intents in `.changes/ade/`, and release notes that name the Lervo CLI the
// release needs. It reads and writes only ADE files, so no CLI release ever sees it.
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadReleaseIntents, ReleaseIntentError } from "./release-intent.mjs";
import { nextCliVersion as nextVersion } from "./release-preparation.mjs";

export const adeReleaseNotesPath = ".changes/ade/current-release.md";
const packagePath = "apps/ade/package.json";
const tauriConfigPath = "apps/ade/src-tauri/tauri.conf.json";
const cargoWorkspacePath = "apps/ade/Cargo.toml";
const cargoLockPath = "apps/ade/Cargo.lock";

const versionPattern = /^\d+\.\d+\.\d+$/u;
const cliRangePattern = /^>=(\d+\.\d+\.\d+)$/u;
const notesMarker =
  /^<!-- lervo-release package="@lervo\/ade" version="(\d+\.\d+\.\d+)" schema="1" -->$/u;
const workspaceVersion = /(\[workspace\.package\][^[]*?\nversion = ")(\d+\.\d+\.\d+)(")/u;

async function text(root, path) {
  return readFile(resolve(root, path), "utf8");
}

/** The workspace crates' names, from the members of the ADE's Cargo workspace. */
async function workspaceCrates(root, workspace) {
  const members = /\nmembers = \[([^\]]*)\]/u.exec(workspace)?.[1] ?? "";
  const names = [];
  for (const member of members.matchAll(/"([^"]+)"/gu)) {
    const manifest = await text(root, `apps/ade/${member[1]}/Cargo.toml`);
    const name = /^name = "([^"]+)"$/mu.exec(manifest)?.[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

/** Every place that carries the ADE's version, as found. */
export async function readAdeVersions(root) {
  const manifest = JSON.parse(await text(root, packagePath));
  const tauri = JSON.parse(await text(root, tauriConfigPath));
  const workspace = await text(root, cargoWorkspacePath);
  const lock = await text(root, cargoLockPath);
  const crates = await workspaceCrates(root, workspace);
  const locked = Object.fromEntries(
    crates.map((name) => [
      name,
      new RegExp(`\\nname = "${name}"\\nversion = "([^"]+)"`, "u").exec(lock)?.[1] ?? null,
    ]),
  );
  return {
    package: manifest.version,
    tauri: tauri.version,
    cargo: workspaceVersion.exec(workspace)?.[2] ?? null,
    locked,
    minimumCli: cliRangePattern.exec(manifest.engines?.lervo ?? "")?.[1] ?? null,
  };
}

/** The files whose version differs from `apps/ade/package.json`. */
export function adeVersionMismatches(versions) {
  const expected = versions.package;
  return [
    ...(versionPattern.test(expected ?? "") ? [] : [packagePath]),
    ...(versions.tauri === expected ? [] : [tauriConfigPath]),
    ...(versions.cargo === expected ? [] : [cargoWorkspacePath]),
    ...Object.entries(versions.locked)
      .filter(([, version]) => version !== expected)
      .map(([name]) => `${cargoLockPath} (${name})`),
  ];
}

/** The ADE's release notes: the version, the Lervo CLI it needs, and each change. */
export function renderAdeReleaseNotes(version, minimumCli, intents) {
  const summaries = intents
    .toSorted(
      (left, right) =>
        left.summary.localeCompare(right.summary) || left.intentId.localeCompare(right.intentId),
    )
    .map((intent) => `- ${intent.summary}`);
  return [
    `<!-- lervo-release package="@lervo/ade" version="${version}" schema="1" -->`,
    "",
    `Needs the Lervo CLI ${minimumCli} or later.`,
    "",
    "## What's changed",
    "",
    ...summaries,
    "",
  ].join("\n");
}

const impactOrder = { patch: 0, minor: 1, major: 2 };

/** The next ADE release from the pending ADE intents, or null when none is pending. */
export async function planAdeRelease(root) {
  const intents = await loadReleaseIntents(root, "ade");
  if (intents.length === 0) return null;
  const versions = await readAdeVersions(root);
  const mismatches = adeVersionMismatches(versions);
  if (mismatches.length > 0)
    throw new ReleaseIntentError(
      "ade_version_mismatch",
      `ADE versions disagree before preparation: ${mismatches.join(", ")}.`,
    );
  if (versions.minimumCli === null)
    throw new ReleaseIntentError(
      "ade_minimum_cli_missing",
      `${packagePath} must name the Lervo CLI it needs as engines.lervo ">=<version>".`,
    );
  const impact = intents.reduce(
    (highest, intent) =>
      impactOrder[intent.impact] > impactOrder[highest] ? intent.impact : highest,
    "patch",
  );
  const version = nextVersion(versions.package, impact);
  return {
    current: versions.package,
    version,
    impact,
    intents,
    notes: renderAdeReleaseNotes(version, versions.minimumCli, intents),
  };
}

/** Writes the planned version everywhere, replaces the notes, and consumes the intents. */
export async function applyAdeRelease(root, plan) {
  const manifest = JSON.parse(await text(root, packagePath));
  await writeFile(
    resolve(root, packagePath),
    `${JSON.stringify({ ...manifest, version: plan.version }, null, 2)}\n`,
  );
  const tauri = JSON.parse(await text(root, tauriConfigPath));
  await writeFile(
    resolve(root, tauriConfigPath),
    `${JSON.stringify({ ...tauri, version: plan.version }, null, 2)}\n`,
  );
  const workspace = await text(root, cargoWorkspacePath);
  await writeFile(
    resolve(root, cargoWorkspacePath),
    workspace.replace(workspaceVersion, `$1${plan.version}$3`),
  );
  let lock = await text(root, cargoLockPath);
  for (const name of await workspaceCrates(root, workspace))
    lock = lock.replace(
      new RegExp(`(\\nname = "${name}"\\nversion = ")[^"]+(")`, "u"),
      `$1${plan.version}$2`,
    );
  await writeFile(resolve(root, cargoLockPath), lock);
  await writeFile(resolve(root, adeReleaseNotesPath), plan.notes);
  for (const intent of plan.intents) await rm(resolve(root, intent.path));
}

/**
 * Whether the ADE's release files agree: every version the same, and notes, when present, for
 * that version. Pending intents are allowed; preparation consumes them.
 */
export async function checkAdeRelease(root) {
  const versions = await readAdeVersions(root);
  const diagnostics = adeVersionMismatches(versions).map((path) => `ade_version_mismatch: ${path}`);
  if (versions.minimumCli === null) diagnostics.push("ade_minimum_cli_missing");
  let notes = null;
  try {
    notes = await text(root, adeReleaseNotesPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (notes !== null) {
    const version = notesMarker.exec(notes.split("\n", 1)[0])?.[1];
    if (version !== versions.package) diagnostics.push("ade_release_notes_version_mismatch");
  }
  const pending = await loadReleaseIntents(root, "ade");
  return {
    valid: diagnostics.length === 0,
    version: versions.package,
    pending: pending.length,
    diagnostics,
  };
}

/**
 * The `ade-v` tag for the prepared release at the current revision, or why there is none: files
 * that disagree, intents still pending, no notes, or a tag that already exists.
 */
export async function planAdeTag(root, tagExists) {
  const report = await checkAdeRelease(root);
  if (!report.valid) return { tag: null, reason: report.diagnostics[0] };
  if (report.pending > 0) return { tag: null, reason: "ade_release_intent_pending" };
  try {
    await text(root, adeReleaseNotesPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { tag: null, reason: "ade_release_notes_missing" };
    throw error;
  }
  const tag = `ade-v${report.version}`;
  if (await tagExists(tag)) return { tag: null, reason: "ade_release_tagged" };
  return { tag, reason: null, message: `Lervo ADE ${report.version}` };
}
