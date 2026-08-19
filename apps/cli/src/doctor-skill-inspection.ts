import { homedir } from "node:os";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { DoctorInspection } from "@lervo/diagnostics";
import { resolveProjectPaths } from "@lervo/project";
import type { SkillLock } from "@lervo/schemas";
import {
  discoverSkillRoot,
  readSkillLock,
  resolveSkills,
  type DiscoveredSkill,
} from "@lervo/skills";

import { doctorInspection, doctorIssue } from "./doctor-inspection-result.js";

export async function inspectDoctorSkills(input: {
  repositoryRoot: string;
  projectId: string;
  userSkillRoot?: string;
}): Promise<DoctorInspection[]> {
  let candidates: DiscoveredSkill[];
  try {
    candidates = [
      ...await discoverSkillRoot({
        root: resolve(input.repositoryRoot, ".agents/skills"),
        sourceKind: "project",
        sourceUriPrefix: ".agents/skills",
      }),
      ...await discoverSkillRoot({
        root: input.userSkillRoot ?? resolve(homedir(), ".agents/skills"),
        sourceKind: "user",
        sourceUriPrefix: "~/.agents/skills",
      }),
    ];
  } catch {
    return [
      doctorInspection("skill_packages", "unhealthy", 0, [
        doctorIssue(
          "skill_package_invalid",
          "스킬 패키지의 manifest, content hash 또는 경로를 확인할 수 없습니다.",
        ),
      ]),
      doctorInspection("skill_lock", "unknown", 0, [
        doctorIssue(
          "skill_lock_invalid",
          "스킬 패키지가 유효하지 않아 skills.lock과 대조하지 못했습니다.",
        ),
      ]),
    ];
  }
  let lock: SkillLock | null;
  try {
    lock = await readSkillLock(resolveProjectPaths(input.repositoryRoot).skillsLock);
  } catch {
    return [
      doctorInspection("skill_packages", "healthy", candidates.length),
      doctorInspection("skill_lock", "unhealthy", 0, [
        doctorIssue(
          "skill_lock_invalid",
          "skills.lock을 안전하게 읽거나 계약에 맞게 해석할 수 없습니다.",
        ),
      ]),
    ];
  }
  if (lock === null) {
    return [
      doctorInspection("skill_packages", "healthy", candidates.length),
      doctorInspection(
        "skill_lock",
        candidates.length === 0 ? "healthy" : "unknown",
        0,
        candidates.length === 0
          ? []
          : [doctorIssue(
            "skill_lock_missing",
            "스킬 패키지는 있지만 실행별 해석 결과인 skills.lock이 아직 없습니다.",
          )],
      ),
    ];
  }
  let stale = lock.projectId !== input.projectId;
  if (!stale) {
    try {
      const current = resolveSkills({
        requestedSkillIds: lock.entries.map((entry) => entry.skillId),
        candidates,
        runtime: {
          projectId: lock.projectId,
          provider: lock.runtime.provider,
          roleId: lock.runtime.roleId,
          runtimeVersion: lock.runtime.runtimeVersion,
          platform: lock.runtime.platform,
          availableTools: lock.runtime.availableTools,
          allowedCapabilities: lock.runtime.allowedCapabilities,
        },
        generatedAt: lock.generatedAt,
      }).lock;
      stale = !isDeepStrictEqual(current, lock);
    } catch {
      stale = true;
    }
  }
  return [
    doctorInspection("skill_packages", "healthy", candidates.length),
    doctorInspection(
      "skill_lock",
      stale ? "unhealthy" : "healthy",
      lock.entries.length,
      stale
        ? [doctorIssue(
          "skill_lock_stale",
          "skills.lock의 project 또는 현재 스킬 해석 결과가 기록된 원본과 다릅니다.",
        )]
        : [],
    ),
  ];
}
