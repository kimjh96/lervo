import { homedir } from "node:os";
import { resolve } from "node:path";

import { resolveProjectPaths } from "@lervo/project";
import type { ManagedResolvedSkill } from "@lervo/orchestrator";
import type { RoleProfile } from "@lervo/schemas";
import {
  discoverSkillRoot,
  resolveSkills,
  SkillResolutionError,
  writeSkillLock,
} from "@lervo/skills";

import type { RunProvider } from "./managed-run.js";

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
    `현재 platform '${process.platform}'에서는 스킬 호환성을 판정할 수 없습니다.`,
  );
}

export type ResolvedRunSkill = ManagedResolvedSkill;

export async function resolveRunSkills(input: {
  repositoryRoot: string;
  projectId: string;
  provider: RunProvider;
  role: RoleProfile;
  skillIds: readonly string[];
  userSkillRoot?: string;
  generatedAt: string;
}): Promise<ResolvedRunSkill[]> {
  if (input.skillIds.length === 0) return [];
  if (input.skillIds.some((skillId) =>
    skillId.length > 150 || !/^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/.test(skillId)
  )) {
    throw new SkillResolutionError(
      "invalid_skill_request",
      "요청한 skill ID가 Lervo 계약에 맞지 않습니다.",
    );
  }
  const candidates = [
    ...await discoverSkillRoot({
      root: resolve(input.repositoryRoot, ".agents/skills"),
      sourceKind: "project",
      sourceUriPrefix: ".agents/skills",
      requestedSkillIds: input.skillIds,
    }),
    ...await discoverSkillRoot({
      root: input.userSkillRoot ?? resolve(homedir(), ".agents/skills"),
      sourceKind: "user",
      sourceUriPrefix: "~/.agents/skills",
      requestedSkillIds: input.skillIds,
    }),
  ];
  const resolution = resolveSkills({
    requestedSkillIds: input.skillIds,
    candidates,
    runtime: {
      projectId: input.projectId,
      provider: input.provider,
      roleId: input.role.roleId,
      runtimeVersion: "0.1.0",
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
  return lock.entries.map((entry) => ({
    skillId: entry.skillId,
    version: entry.version,
    contentHash: entry.contentHash,
    sourceKind: entry.source.kind,
    trustStatus: entry.trustStatus,
  }));
}
