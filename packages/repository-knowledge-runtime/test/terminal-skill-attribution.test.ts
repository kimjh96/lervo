import { expect, it } from "vitest";
import { attributeTerminalSkills } from "../src/terminal-skill-attribution.js";
import type { InstalledTerminalSkills } from "../src/terminal-installed-skills.js";

const skill = {
  skillId: "eli5",
  path: ".agents/skills/eli5/SKILL.md",
  contentHash: `sha256:${"a".repeat(64)}`,
};

it("does not let an explicit pointer bypass conflicting provider resolution", () => {
  const catalog: InstalledTerminalSkills = {
    skills: [skill],
    resolve: () => ({ status: "ambiguous" }),
  };
  expect(
    attributeTerminalSkills({
      provider: "claude",
      catalog,
      assessment: { skillTelemetry: "observed", identifiers: ["eli5"] },
      selectedPointers: [{ kind: "skill", ...skill }],
    }),
  ).toMatchObject({
    observations: [],
    skillTelemetry: "unknown",
    ambiguousSkillCount: 2,
    externalSkillCount: 0,
  });
});

it("caps transcript observations and refuses a pointer whose current bytes differ from Stop", () => {
  const catalog: InstalledTerminalSkills = {
    skills: [skill],
    resolve: () => ({ status: "installed", skill }),
  };
  expect(
    attributeTerminalSkills({
      provider: "claude",
      catalog,
      assessment: { skillTelemetry: "observed", identifiers: Array(1025).fill("eli5") },
      selectedPointers: [],
    }),
  ).toMatchObject({ observations: [], skillTelemetry: "truncated" });
  expect(
    attributeTerminalSkills({
      provider: "claude",
      catalog,
      assessment: { skillTelemetry: "unavailable", identifiers: [] },
      selectedPointers: [
        { kind: "skill", path: skill.path, contentHash: `sha256:${"b".repeat(64)}` },
      ],
    }),
  ).toMatchObject({
    observations: [],
    skillTelemetry: "unknown",
    unknownSkillCount: 1,
    externalSkillCount: 0,
  });
});
