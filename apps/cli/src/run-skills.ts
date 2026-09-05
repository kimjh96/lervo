import { homedir } from "node:os";
import { resolve } from "node:path";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

import { resolveProjectPaths } from "@lervo/project";
import type { ManagedResolvedSkill } from "@lervo/orchestrator";
import type { RoleProfile } from "@lervo/schemas";
import {
  discoverSkillRoot,
  hashSkillPackage,
  resolveSkills,
  SkillResolutionError,
  writeSkillLock,
} from "@lervo/skills";
import { capabilityRoot } from "@lervo/capabilities";

import type { RunProvider } from "./managed-run.js";
import { readCliPackageVersion } from "./version-command.js";

const availableTools: Record<RunProvider, readonly string[]> = {
  codex: ["filesystem.read", "filesystem.write", "shell"],
  claude: ["filesystem.read", "filesystem.write"],
};

function runtimePlatform(): "darwin" | "linux" | "win32" {
  if (
    process.platform === "darwin" ||
    process.platform === "linux" ||
    process.platform === "win32"
  ) {
    return process.platform;
  }
  throw new SkillResolutionError(
    "unsupported_runtime_platform",
    `Skill compatibility cannot be determined on platform '${process.platform}'.`,
  );
}

export type ResolvedRunSkill = ManagedResolvedSkill;

export interface PreparedRunSkills {
  resolved: ResolvedRunSkill[];
  instructionBlocks: Array<{
    skillId: string;
    version: string;
    contentHash: string;
    content: string;
  }>;
}

export async function resolveRunSkills(input: {
  repositoryRoot: string;
  projectId: string;
  provider: RunProvider;
  role: RoleProfile;
  skillIds: readonly string[];
  userSkillRoot?: string;
  userCapabilityRoot?: string;
  generatedAt: string;
}): Promise<PreparedRunSkills> {
  if (input.skillIds.length === 0) return { resolved: [], instructionBlocks: [] };
  if (
    input.skillIds.some(
      (skillId) => skillId.length > 150 || !/^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/.test(skillId),
    )
  ) {
    throw new SkillResolutionError(
      "invalid_skill_request",
      "A requested skill ID does not satisfy the Lervo contract.",
    );
  }
  const candidates = [
    ...(await discoverSkillRoot({
      root: resolve(input.repositoryRoot, ".agents/skills"),
      sourceKind: "project",
      sourceUriPrefix: ".agents/skills",
      requestedSkillIds: input.skillIds,
    })),
    ...(await discoverSkillRoot({
      root: capabilityRoot(input.repositoryRoot, "project"),
      sourceKind: "project",
      sourceUriPrefix: ".lervo/capabilities/packages",
      requestedSkillIds: input.skillIds,
    })),
    ...(await discoverSkillRoot({
      root: input.userSkillRoot ?? resolve(homedir(), ".agents/skills"),
      sourceKind: "user",
      sourceUriPrefix: "~/.agents/skills",
      requestedSkillIds: input.skillIds,
    })),
    ...(await discoverSkillRoot({
      root: capabilityRoot(input.repositoryRoot, "user", input.userCapabilityRoot),
      sourceKind: "user",
      sourceUriPrefix: "~/.lervo/capabilities/packages",
      requestedSkillIds: input.skillIds,
    })),
  ];
  const resolution = resolveSkills({
    requestedSkillIds: input.skillIds,
    candidates,
    runtime: {
      projectId: input.projectId,
      provider: input.provider,
      roleId: input.role.roleId,
      runtimeVersion: readCliPackageVersion(),
      platform: runtimePlatform(),
      availableTools: availableTools[input.provider],
      allowedCapabilities: Object.entries(input.role.capabilities)
        .filter(([, disposition]) => disposition === "allow")
        .map(([capability]) => capability),
    },
    generatedAt: input.generatedAt,
  });
  const lock = await writeSkillLock(
    resolveProjectPaths(input.repositoryRoot).skillsLock,
    resolution.lock,
  );
  const resolved = lock.entries.map((entry) => ({
    skillId: entry.skillId,
    version: entry.version,
    contentHash: entry.contentHash,
    sourceKind: entry.source.kind,
    trustStatus: entry.trustStatus,
  }));
  const instructionBlocks = await Promise.all(
    resolution.selected.map(async (candidate) => {
      const path = resolve(candidate.directoryPath, "SKILL.md");
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let bytes: Uint8Array;
      try {
        const stats = await handle.stat();
        if (!stats.isFile() || stats.size > 512 * 1024)
          throw new SkillResolutionError(
            "unsafe_skill_package",
            "SKILL.md is not a bounded regular file.",
          );
        bytes = await handle.readFile();
      } finally {
        await handle.close();
      }
      if ((await hashSkillPackage(candidate.directoryPath)) !== candidate.manifest.contentHash) {
        throw new SkillResolutionError(
          "content_hash_mismatch",
          "A selected skill changed while its instructions were loaded.",
        );
      }
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (error) {
        throw new SkillResolutionError("unsafe_skill_package", "SKILL.md is not valid UTF-8.", {
          cause: error,
        });
      }
      return {
        skillId: candidate.manifest.skillId,
        version: candidate.manifest.version,
        contentHash: candidate.manifest.contentHash,
        content,
      };
    }),
  );
  return { resolved, instructionBlocks };
}
