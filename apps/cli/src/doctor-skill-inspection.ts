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
          "Could not validate a skill package manifest, content hash, or path.",
        ),
      ]),
      doctorInspection("skill_lock", "unknown", 0, [
        doctorIssue(
          "skill_lock_invalid",
          "Could not compare skills.lock because a skill package is invalid.",
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
          "Could not safely read or validate skills.lock against its contract.",
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
            "Skill packages exist, but no per-run resolution record exists in skills.lock yet.",
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
          "The skills.lock project or current skill resolution differs from the recorded source.",
        )]
        : [],
    ),
  ];
}
