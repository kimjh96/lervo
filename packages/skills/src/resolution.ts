import type { SkillLock, SkillLockRejection } from "@roven/schemas";

import { compareSemver, rejectionReason } from "./compatibility.js";
import {
  SkillResolutionError,
  type DiscoveredSkill,
  type SkillResolution,
  type SkillRuntimeContext,
} from "./types.js";

function rejection(
  candidate: DiscoveredSkill,
  reasonCode: SkillLockRejection["reasonCode"],
): SkillLockRejection {
  return {
    skillId: candidate.manifest.skillId,
    version: candidate.manifest.version,
    contentHash: candidate.manifest.contentHash,
    sourceKind: candidate.source.kind,
    reasonCode,
  };
}

function priority(candidate: DiscoveredSkill): number {
  if (candidate.source.kind === "project" && candidate.manifest.pinned) return 0;
  return candidate.source.kind === "project" ? 1 : 2;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function candidateOrder(left: DiscoveredSkill, right: DiscoveredSkill): number {
  return priority(left) - priority(right) ||
    compareSemver(right.manifest.version, left.manifest.version) ||
    compareText(left.manifest.contentHash, right.manifest.contentHash) ||
    compareText(left.source.uri, right.source.uri);
}

export function resolveSkills(input: {
  requestedSkillIds: readonly string[];
  candidates: readonly DiscoveredSkill[];
  runtime: SkillRuntimeContext;
  generatedAt: string;
}): SkillResolution {
  const requestedIds = [...new Set(input.requestedSkillIds)].sort();
  const selected: DiscoveredSkill[] = [];
  const rejected: SkillLockRejection[] = [];
  for (const skillId of requestedIds) {
    const matching = input.candidates.filter((candidate) => candidate.manifest.skillId === skillId);
    if (matching.length === 0) {
      throw new SkillResolutionError("skill_not_found", `요청한 스킬 '${skillId}'을 찾지 못했습니다.`);
    }
    const compatible: DiscoveredSkill[] = [];
    for (const candidate of matching) {
      const reason = rejectionReason(candidate, input.runtime);
      if (reason === null) compatible.push(candidate);
      else rejected.push(rejection(candidate, reason));
    }
    if (compatible.length === 0) {
      const reasons = rejected
        .filter((item) => item.skillId === skillId)
        .map((item) => item.reasonCode);
      throw new SkillResolutionError(
        "no_compatible_skill",
        `요청한 스킬 '${skillId}'에 현재 실행과 호환되는 후보가 없습니다.`,
        { reasons },
      );
    }
    compatible.sort(candidateOrder);
    const winner = compatible[0]!;
    const sameRank = compatible.filter((candidate) =>
      priority(candidate) === priority(winner) &&
      compareSemver(candidate.manifest.version, winner.manifest.version) === 0
    );
    if (sameRank.some((candidate) => candidate.manifest.contentHash !== winner.manifest.contentHash)) {
      throw new SkillResolutionError(
        "ambiguous_skill_selection",
        `스킬 '${skillId}'의 같은 우선순위와 version에 서로 다른 내용이 있습니다.`,
      );
    }
    selected.push(winner);
    for (const candidate of compatible) {
      if (candidate === winner) continue;
      rejected.push(rejection(
        candidate,
        priority(candidate) === priority(winner) ? "version_shadowed" : "source_shadowed",
      ));
    }
  }
  rejected.sort((left, right) =>
    compareText(left.skillId, right.skillId) ||
    compareText(left.sourceKind, right.sourceKind) ||
    compareSemver(right.version, left.version) ||
    compareText(left.contentHash, right.contentHash) ||
    compareText(left.reasonCode, right.reasonCode)
  );
  const lock: SkillLock = {
    schemaVersion: 1,
    projectId: input.runtime.projectId,
    generatedAt: input.generatedAt,
    runtime: {
      provider: input.runtime.provider,
      roleId: input.runtime.roleId,
      runtimeVersion: input.runtime.runtimeVersion,
      platform: input.runtime.platform,
      availableTools: [...new Set(input.runtime.availableTools)].sort(),
      allowedCapabilities: [...new Set(input.runtime.allowedCapabilities)].sort() as SkillLock["runtime"]["allowedCapabilities"],
    },
    entries: selected.map((candidate) => ({
      skillId: candidate.manifest.skillId,
      version: candidate.manifest.version,
      contentHash: candidate.manifest.contentHash,
      source: structuredClone(candidate.source),
      trustStatus: candidate.manifest.trust.level,
      pinned: candidate.manifest.pinned,
    })),
    rejected,
  };
  return { lock, selected, rejected };
}
