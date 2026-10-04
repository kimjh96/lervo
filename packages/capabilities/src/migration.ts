import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { installCapabilityPackage, capabilityRoot } from "./resolution.js";
import { hashCapabilityPackageFiles, readCapabilityPackage } from "./package-reader.js";
import { CapabilityPackageError, type VerifiedCapabilityPackage } from "./types.js";
import { readMigratedSkillPackage } from "./skill-migration-package.js";

export interface CapabilityMigrationItem {
  sourcePath: string;
  targetPath: string;
  capabilityId: string;
  version: string;
  contentHash: string;
  packageHash: string;
  action: "create" | "unchanged";
}

export interface CapabilityMigrationPlan {
  schemaVersion: 1;
  planKind: "capability_repository_migration";
  planId: string;
  repositoryRoot: string;
  status: "ready" | "current";
  items: CapabilityMigrationItem[];
  observedProviderSurfaces: Array<{
    kind: "mcp_or_plugin_configuration";
    path: string;
    disposition: "unmanaged_provider_owned";
  }>;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function sourceDirectories(root: string): Promise<string[]> {
  const path = resolve(root, ".agents/skills");
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new CapabilityPackageError(
        "capability_unsafe_package",
        ".agents/skills must be a physical directory.",
      );
    return (await readdir(path, { withFileTypes: true }))
      .filter((item) => item.isDirectory() && !item.isSymbolicLink())
      .map((item) => resolve(path, item.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function packagePath(root: string, capabilityId: string, version: string): string {
  return resolve(capabilityRoot(root, "project"), `${encodeURIComponent(capabilityId)}@${version}`);
}

async function installedPackage(path: string): Promise<VerifiedCapabilityPackage | null> {
  try {
    return await readCapabilityPackage(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Installed project versions of one capability, in ascending semantic-version order. */
async function installedVersions(root: string, capabilityId: string): Promise<string[]> {
  const prefix = `${encodeURIComponent(capabilityId)}@`;
  let names: string[];
  try {
    names = await readdir(capabilityRoot(root, "project"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((name) => name.startsWith(prefix) && /^\d+\.\d+\.\d+$/u.test(name.slice(prefix.length)))
    .map((name) => name.slice(prefix.length))
    .sort((left, right) => {
      const [a, b] = [left, right].map((value) => value.split(".").map(Number));
      return a![0]! - b![0]! || a![1]! - b![1]! || a![2]! - b![2]!;
    });
}

/**
 * A loose skill without an authored manifest is versioned by Lervo. Editing it after migration
 * creates the next patch version instead of conflicting forever with its immutable predecessor;
 * bytes equal to an installed version reuse that version. Authored versions still conflict.
 */
async function migratedSkillPackage(
  root: string,
  directory: string,
): Promise<{ value: VerifiedCapabilityPackage; action: CapabilityMigrationItem["action"] } | null> {
  const authored = await readMigratedSkillPackage(directory);
  if (authored === null) return null;
  const generated =
    !(await exists(resolve(directory, "lervo-skill.json"))) &&
    !(await exists(resolve(directory, "lervo-capability.json")));
  const versions = generated
    ? await installedVersions(root, authored.manifest.capabilityId)
    : [authored.manifest.version];
  for (const version of versions) {
    const value = generated ? await readMigratedSkillPackage(directory, version) : authored;
    const current = await installedPackage(
      packagePath(root, authored.manifest.capabilityId, version),
    );
    if (value === null || current === null) continue;
    if (hashCapabilityPackageFiles(current.files) === hashCapabilityPackageFiles(value.files))
      return { value, action: "unchanged" };
    if (!generated)
      throw new CapabilityPackageError(
        "capability_conflict",
        `Capability '${authored.manifest.capabilityId}' already has different bytes at ${version}.`,
      );
  }
  const latest = versions.at(-1);
  const next =
    !generated || latest === undefined
      ? authored.manifest.version
      : latest.replace(/\d+$/u, (patch) => String(Number(patch) + 1));
  const value = generated ? await readMigratedSkillPackage(directory, next) : authored;
  return value === null ? null : { value, action: "create" };
}

export async function createCapabilityMigrationPlan(
  repositoryRoot: string,
): Promise<CapabilityMigrationPlan> {
  const root = resolve(repositoryRoot);
  const packages = (
    await Promise.all(
      (await sourceDirectories(root)).map((directory) => migratedSkillPackage(root, directory)),
    )
  ).filter((item) => item !== null);
  const items: CapabilityMigrationItem[] = [];
  for (const { value, action } of packages) {
    const targetPath = packagePath(root, value.manifest.capabilityId, value.manifest.version);
    items.push({
      sourcePath: `.agents/skills/${basename(value.directoryPath)}`,
      targetPath: `.lervo/capabilities/packages/${basename(targetPath)}`,
      capabilityId: value.manifest.capabilityId,
      version: value.manifest.version,
      contentHash: value.manifest.contentHash,
      packageHash: hashCapabilityPackageFiles(value.files),
      action,
    });
  }
  const providerPaths = [
    ".codex/config.toml",
    ".codex/plugins",
    ".claude/settings.json",
    ".claude/plugins",
  ];
  const observedProviderSurfaces = (
    await Promise.all(
      providerPaths.map(async (path) =>
        (await exists(resolve(root, path)))
          ? [
              {
                kind: "mcp_or_plugin_configuration" as const,
                path,
                disposition: "unmanaged_provider_owned" as const,
              },
            ]
          : [],
      ),
    )
  ).flat();
  const materials = { items, observedProviderSurfaces };
  return {
    schemaVersion: 1,
    planKind: "capability_repository_migration",
    planId: `kcapmig_${digest(materials).slice("sha256:".length, 24 + "sha256:".length)}`,
    repositoryRoot: root,
    status: items.some((item) => item.action === "create") ? "ready" : "current",
    ...materials,
  };
}

export async function applyCapabilityMigration(
  plan: CapabilityMigrationPlan,
): Promise<CapabilityMigrationPlan> {
  const current = await createCapabilityMigrationPlan(plan.repositoryRoot);
  if (current.planId !== plan.planId)
    throw new CapabilityPackageError(
      "capability_approval_mismatch",
      "The capability migration plan changed before apply.",
    );
  for (const item of current.items.filter((value) => value.action === "create")) {
    const packageValue = await readMigratedSkillPackage(
      resolve(current.repositoryRoot, item.sourcePath),
      item.version,
    );
    if (
      packageValue === null ||
      packageValue.manifest.contentHash !== item.contentHash ||
      hashCapabilityPackageFiles(packageValue.files) !== item.packageHash
    )
      throw new CapabilityPackageError(
        "capability_approval_mismatch",
        "A capability migration source changed before apply.",
      );
    await installCapabilityPackage({
      repositoryRoot: current.repositoryRoot,
      scope: "project",
      package: packageValue,
    });
  }
  return createCapabilityMigrationPlan(current.repositoryRoot);
}
