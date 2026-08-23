import { homedir } from "node:os";
import { resolve } from "node:path";

import type { ManagedResolvedSkill } from "@lervo/orchestrator";
import { resolveProjectPaths } from "@lervo/project";
import type { RoleProfile } from "@lervo/schemas";
import {
  discoverSkillRoot,
  resolveSkills,
  SkillResolutionError,
  writeSkillLock,
} from "@lervo/skills";

const availableTools: Readonly<Record<string, readonly string[]>> = {
  codex: ["filesystem.read", "filesystem.write", "shell"],
  claude: ["filesystem.read", "filesystem.write"],
};

function runtimePlatform(): "darwin" | "linux" | "win32" {
  if (
    process.platform === "darwin" || process.platform === "linux" ||
    process.platform === "win32"
  ) return process.platform;
  throw new SkillResolutionError(
    "unsupported_runtime_platform",
    "Managed provider skill compatibility cannot be determined on the current platform.",
  );
}

export async function resolveManagedProviderHostSkills(input: {
  repositoryRoot: string;
  projectId: string;
  provider: string;
  role: RoleProfile;
  generatedAt: string;
  userSkillRoot?: string;
}): Promise<ManagedResolvedSkill[]> {
  const skillIds = input.role.defaultSkills;
  if (skillIds.length === 0) return [];
  const tools = availableTools[input.provider];
  if (tools === undefined) {
    throw new SkillResolutionError(
      "no_compatible_skill",
      "Skill compatibility cannot be determined for an unregistered provider.",
    );
  }
  const candidates = [
    ...await discoverSkillRoot({
      root: resolve(input.repositoryRoot, ".agents/skills"),
      sourceKind: "project",
      sourceUriPrefix: ".agents/skills",
      requestedSkillIds: skillIds,
    }),
    ...await discoverSkillRoot({
      root: input.userSkillRoot ?? resolve(homedir(), ".agents/skills"),
      sourceKind: "user",
      sourceUriPrefix: "~/.agents/skills",
      requestedSkillIds: skillIds,
    }),
  ];
  const resolution = resolveSkills({
    requestedSkillIds: skillIds,
    candidates,
    runtime: {
      projectId: input.projectId,
      provider: input.provider,
      roleId: input.role.roleId,
      runtimeVersion: "0.1.0",
      platform: runtimePlatform(),
      availableTools: tools,
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
  return lock.entries.map((entry) => ({
    skillId: entry.skillId,
    version: entry.version,
    contentHash: entry.contentHash,
    sourceKind: entry.source.kind,
    trustStatus: entry.trustStatus,
  }));
}
