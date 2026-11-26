import { lstat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { validateSchema, type CapabilityPackageManifest, type SkillManifest } from "@lervo/schemas";

import {
  CAPABILITY_MANIFEST,
  hashCapabilityFiles,
  readCapabilityContentFiles,
  readCapabilityPackage,
} from "./package-reader.js";
import { CapabilityPackageError, type VerifiedCapabilityPackage } from "./types.js";

function boundedText(value: string, maximumCharacters: number): string {
  return [...value].slice(0, maximumCharacters).join("");
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
  return value === undefined || value.length < 3 ? null : boundedText(value, 500);
}

function skillName(content: string, directoryPath: string): string {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(content)?.[1];
  const declared = frontmatter?.match(/^name:\s*["']?(.+?)["']?\s*$/mu)?.[1]?.trim();
  return declared === undefined || declared.length === 0 ? basename(directoryPath) : declared;
}

async function promotedSkillPackage(
  directoryPath: string,
): Promise<VerifiedCapabilityPackage | null> {
  if (!(await exists(resolve(directoryPath, CAPABILITY_MANIFEST)))) return null;
  const value = await readCapabilityPackage(directoryPath);
  if (value.manifest.kind !== "skill")
    throw new CapabilityPackageError(
      "capability_invalid",
      `${directoryPath}/${CAPABILITY_MANIFEST} must describe a skill capability.`,
    );
  const skillFile = value.files.find((file) => file.path === "lervo-skill.json");
  const skill = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(skillFile!.bytes),
  ) as SkillManifest;
  if (
    skill.source.publisher.id === "lervo.development-pattern" &&
    (skill.trust.level === "untrusted" || skill.enabledScope.kind !== "projects")
  )
    throw new CapabilityPackageError(
      "capability_invalid",
      `Development-pattern skill '${skill.skillId}' requires exact project authorization before migration.`,
    );
  return value;
}

/** `version` applies only to a generated manifest; an authored manifest keeps its own version. */
export async function readMigratedSkillPackage(
  directoryPath: string,
  version = "1.0.0",
): Promise<VerifiedCapabilityPackage | null> {
  const promoted = await promotedSkillPackage(directoryPath);
  if (promoted !== null) return promoted;
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
      version,
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
    } catch (error) {
      throw new CapabilityPackageError(
        "capability_invalid",
        `${directoryPath}/lervo-skill.json is invalid.`,
        { cause: error },
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
            intents: [boundedText(summary, 200)],
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
