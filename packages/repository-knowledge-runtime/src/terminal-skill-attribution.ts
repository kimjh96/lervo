import type {
  InstalledTerminalSkills,
  InstalledTerminalSkill,
} from "./terminal-installed-skills.js";
import type { SkillTranscriptAssessment } from "./terminal-skill-transcript.js";

/** Pure attribution against one immutable provider catalog. Unknown membership is never external. */
export function attributeTerminalSkills(input: {
  provider: "claude" | "codex";
  catalog: InstalledTerminalSkills | null;
  assessment: SkillTranscriptAssessment;
  selectedPointers: unknown;
}) {
  const { provider, catalog, selectedPointers } = input;
  const assessment = { ...input.assessment };
  const observations: Array<
    InstalledTerminalSkill & { source: "provider_transcript" | "prompt_invocation" }
  > = [];
  let externalSkillCount = 0;
  let unknownSkillCount = 0;
  let ambiguousSkillCount = 0;
  if (assessment.identifiers.length > 1024) {
    assessment.skillTelemetry = "truncated";
    assessment.identifiers = [];
  }
  for (const identifier of assessment.identifiers) {
    const resolution = catalog?.resolve(provider, identifier);
    if (resolution?.status === "installed")
      observations.push({ ...resolution.skill, source: "provider_transcript" });
    else if (resolution?.status === "external") externalSkillCount++;
    else if (resolution?.status === "ambiguous") ambiguousSkillCount++;
    else unknownSkillCount++;
  }
  if (Array.isArray(selectedPointers)) {
    for (const pointer of selectedPointers as Array<{
      kind?: unknown;
      path?: unknown;
      contentHash?: unknown;
    }>) {
      if (pointer.kind !== "skill") continue;
      const skill = catalog?.skills.find(
        (item) => item.path === pointer.path && item.contentHash === pointer.contentHash,
      );
      const resolution =
        skill === undefined ? undefined : catalog?.resolve(provider, skill.skillId);
      if (resolution?.status === "ambiguous") ambiguousSkillCount++;
      else if (
        skill !== undefined &&
        resolution?.status === "installed" &&
        resolution.skill.path === skill.path &&
        observations.length < 1024
      )
        observations.push({ ...skill, source: "prompt_invocation" });
      else unknownSkillCount++;
    }
  }
  const skillTelemetry =
    unknownSkillCount > 0 || ambiguousSkillCount > 0 ? "unknown" : assessment.skillTelemetry;
  return {
    observations,
    skillTelemetry,
    externalSkillCount,
    unknownSkillCount,
    ambiguousSkillCount,
  };
}
