import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { validateSchema, type CapabilityPackageManifest, type SkillManifest } from "@lervo/schemas";

import { installCapabilityPackage, capabilityRoot } from "./resolution.js";
import {
  CAPABILITY_MANIFEST,
  hashCapabilityFiles,
  readCapabilityContentFiles,
  readCapabilityPackage,
} from "./package-reader.js";
import { CapabilityPackageError, type VerifiedCapabilityPackage } from "./types.js";

export interface CapabilityMigrationItem {
  sourcePath: string;
  targetPath: string;
  capabilityId: string;
  version: string;
  contentHash: string;
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

function description(content: string): string | null {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(content)?.[1];
  const value = frontmatter?.match(/^description:\s*["']?(.+?)["']?\s*$/mu)?.[1]?.trim();
  return value === undefined || value.length < 3 ? null : value.slice(0, 500);
}

function skillName(content: string, directoryPath: string): string {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(content)?.[1];
  const declared = frontmatter?.match(/^name:\s*["']?(.+?)["']?\s*$/mu)?.[1]?.trim();
  return declared === undefined || declared.length === 0 ? basename(directoryPath) : declared;
}

async function migratedSkillPackage(
  directoryPath: string,
): Promise<VerifiedCapabilityPackage | null> {
  const files = await readCapabilityContentFiles(directoryPath);
  const instructions = files.find((file) => file.path === "SKILL.md");
  if (instructions === undefined) return null;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(instructions.bytes);
  const contentHash = hashCapabilityFiles(files);
  const manifestFile = files.find((file) => file.path === "lervo-skill.json");
  let skill: SkillManifest;
  let packageFiles = files;
  if (manifestFile === undefined) {
    skill = {
      schemaVersion: 1,
      skillId: skillName(text, directoryPath),
      version: "1.0.0",
      contentHash,
      source: {
        kind: "project",
        uri: `.agents/skills/${basename(directoryPath)}`,
        publisher: { id: "lervo.repository-migration", name: "Lervo repository migration" },
      },
      supportedRoles: ["*"],
      compatibility: {
        providers: { mode: "any" },
        minimumRuntimeVersion: "0.1.0",
        platforms: ["darwin", "linux", "win32"],
        requiredTools: [],
        unknownIsCompatible: false,
      },
      requiredCapabilities: [],
      contracts: {
        inputSchemaRef: "lervo-schema://skill/input/v1",
        outputSchemaRef: "lervo-schema://skill/output/v1",
      },
      trust: { level: "untrusted", signatureStatus: "unsigned" },
      enabledScope: { kind: "user" },
      pinned: false,
    };
    if (!validateSchema("skill", skill).valid)
      throw new CapabilityPackageError(
        "capability_invalid",
        `${directoryPath}/SKILL.md has no valid portable skill name for migration.`,
      );
    packageFiles = [
      ...files,
      {
        path: "lervo-skill.json",
        bytes: new TextEncoder().encode(`${JSON.stringify(skill, null, 2)}\n`),
      },
    ];
  } else {
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestFile.bytes));
    } catch {
      throw new CapabilityPackageError(
        "capability_invalid",
        `${directoryPath}/lervo-skill.json is invalid.`,
      );
    }
    if (!validateSchema("skill", raw).valid)
      throw new CapabilityPackageError(
        "capability_invalid",
        `${directoryPath}/lervo-skill.json does not satisfy the skill contract.`,
      );
    skill = raw as SkillManifest;
  }
  if (contentHash !== skill.contentHash)
    throw new CapabilityPackageError(
      "capability_content_hash_mismatch",
      `Skill '${skill.skillId}' changed before migration.`,
    );
  const summary = description(text);
  const keywords = [
    ...new Set(skill.skillId.split(/[._/-]+/u).filter((item) => item.length >= 2)),
  ].slice(0, 32);
  const manifest: CapabilityPackageManifest = {
    schemaVersion: 1,
    capabilityId: skill.skillId,
    kind: "skill",
    version: skill.version,
    contentHash,
    source: {
      kind: "project",
      uri: `.agents/skills/${basename(directoryPath)}`,
      publisher: structuredClone(skill.source.publisher),
    },
    compatibility: {
      providers: structuredClone(skill.compatibility.providers),
      minimumRuntimeVersion: skill.compatibility.minimumRuntimeVersion,
      platforms: [...skill.compatibility.platforms],
    },
    requiredPermissions: [...skill.requiredCapabilities],
    dependencies: [],
    ...(summary === null || keywords.length === 0
      ? {}
      : {
          discovery: {
            displayName: skill.skillId,
            summary,
            keywords,
            intents: [summary],
            autoSelect: true,
          },
        }),
    entrypoint: { kind: "skill", skillId: skill.skillId, manifestPath: "lervo-skill.json" },
    activation: "explicit",
    publication: { defaultVisibility: "local", secretMaterial: "excluded" },
  };
  if (!validateSchema("capabilityPackageManifest", manifest).valid)
    throw new CapabilityPackageError(
      "capability_invalid",
      `Generated capability contract for '${skill.skillId}' is invalid.`,
    );
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  return {
    manifest,
    directoryPath,
    files: [{ path: CAPABILITY_MANIFEST, bytes: manifestBytes }, ...packageFiles],
  };
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

export async function createCapabilityMigrationPlan(
  repositoryRoot: string,
): Promise<CapabilityMigrationPlan> {
  const root = resolve(repositoryRoot);
  const packages = (
    await Promise.all((await sourceDirectories(root)).map(migratedSkillPackage))
  ).filter((item): item is VerifiedCapabilityPackage => item !== null);
  const items: CapabilityMigrationItem[] = [];
  for (const value of packages) {
    const targetPath = resolve(
      capabilityRoot(root, "project"),
      `${encodeURIComponent(value.manifest.capabilityId)}@${value.manifest.version}`,
    );
    let action: CapabilityMigrationItem["action"] = "create";
    try {
      const current = await readCapabilityPackage(targetPath);
      if (current.manifest.contentHash !== value.manifest.contentHash)
        throw new CapabilityPackageError(
          "capability_conflict",
          `Capability '${value.manifest.capabilityId}' already has different bytes at ${value.manifest.version}.`,
        );
      action = "unchanged";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    items.push({
      sourcePath: `.agents/skills/${basename(value.directoryPath)}`,
      targetPath: `.lervo/capabilities/packages/${basename(targetPath)}`,
      capabilityId: value.manifest.capabilityId,
      version: value.manifest.version,
      contentHash: value.manifest.contentHash,
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
    const packageValue = await migratedSkillPackage(
      resolve(current.repositoryRoot, item.sourcePath),
    );
    if (packageValue === null || packageValue.manifest.contentHash !== item.contentHash)
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
