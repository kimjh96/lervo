import { sha256 } from "@lervo/repository-knowledge";
import { terminalSkillRevisionFiles } from "./terminal-skill-revision-files.js";

const SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;

export interface InstalledTerminalSkill {
  skillId: string;
  path: string;
  contentHash: string;
}
export type TerminalSkillResolution =
  | { status: "installed"; skill: InstalledTerminalSkill }
  | { status: "ambiguous" | "unknown" | "external" };
export interface InstalledTerminalSkills {
  skills: InstalledTerminalSkill[];
  resolve(provider: "claude" | "codex", identifier: string): TerminalSkillResolution;
}

/** Portable membership and provider precedence are resolved at the closing turn's commit. */
export async function installedTerminalSkills(
  root: string,
  revision?: string,
): Promise<InstalledTerminalSkills> {
  const files = await terminalSkillRevisionFiles(root, revision);
  const skills: InstalledTerminalSkill[] = [];
  const portable = new Map<string, InstalledTerminalSkill>();
  const byPath = new Map<string, InstalledTerminalSkill>();
  for (const name of files.names(".agents/skills")) {
    if (!SKILL_ID.test(name)) continue;
    const path = `.agents/skills/${name}/SKILL.md`;
    const actual = await files.follow(path);
    const bytes = actual === null ? null : await files.read(actual);
    if (bytes === null) continue;
    const skill = { skillId: name, path, contentHash: sha256(bytes) };
    skills.push(skill);
    portable.set(name, skill);
    byPath.set(actual!, skill);
  }
  const surfaces = {
    claude: new Map<string, TerminalSkillResolution>(),
    codex: new Map<string, TerminalSkillResolution>(),
  };
  for (const provider of ["claude", "codex"] as const) {
    for (const name of files.names(`.${provider}/skills`)) {
      if (!SKILL_ID.test(name)) continue;
      const actual = await files.follow(`.${provider}/skills/${name}/SKILL.md`);
      const skill = actual === null ? undefined : byPath.get(actual);
      const sameName = portable.get(name);
      surfaces[provider].set(
        name,
        sameName && sameName !== skill
          ? { status: "ambiguous" }
          : skill
            ? { status: "installed", skill }
            : { status: actual === null ? "external" : "unknown" },
      );
    }
  }
  return {
    skills,
    resolve(provider, identifier) {
      const surface = surfaces[provider].get(identifier);
      if (surface) return surface;
      if (provider === "claude")
        return { status: identifier.includes(":") ? "external" : "unknown" };
      const skill = portable.get(identifier);
      if (skill) return { status: "installed", skill };
      // An absent bare name may be uncommitted. Namespaced plugin names identify external skills.
      return { status: identifier.includes(":") ? "external" : "unknown" };
    },
  };
}
