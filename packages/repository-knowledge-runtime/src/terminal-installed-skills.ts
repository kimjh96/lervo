import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { sha256 } from "@lervo/repository-knowledge";

const SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const MAXIMUM_SKILLS = 1024;
const MAXIMUM_SKILL_BYTES = 256 * 1024;

export interface InstalledTerminalSkill {
  skillId: string;
  path: string;
  contentHash: string;
}

export interface InstalledTerminalSkills {
  skills: InstalledTerminalSkill[];
  resolve(provider: "claude" | "codex", identifier: string): InstalledTerminalSkill | undefined;
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../");
}

async function names(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path);
    if (entries.length > MAXIMUM_SKILLS)
      throw new Error("Installed skill catalog exceeds its bound.");
    return entries.sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Only portable repository files establish membership; provider links can add exact aliases. */
export async function installedTerminalSkills(root: string): Promise<InstalledTerminalSkills> {
  const repository = await realpath(root);
  const skills: InstalledTerminalSkill[] = [];
  const byRealPath = new Map<string, InstalledTerminalSkill>();
  for (const name of await names(resolve(root, ".agents/skills"))) {
    if (!SKILL_ID.test(name)) continue;
    const path = `.agents/skills/${name}/SKILL.md`;
    let actual: string;
    try {
      actual = await realpath(resolve(root, path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!within(repository, actual)) continue;
    const handle = await open(
      actual,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK,
    );
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAXIMUM_SKILL_BYTES)
        throw new Error("Installed skill is unreadable or oversized.");
      const bytes = Buffer.alloc(MAXIMUM_SKILL_BYTES + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > MAXIMUM_SKILL_BYTES) throw new Error("Installed skill exceeds its bound.");
      const skill = { skillId: name, path, contentHash: sha256(bytes.subarray(0, bytesRead)) };
      skills.push(skill);
      byRealPath.set(actual, skill);
    } finally {
      await handle.close();
    }
  }
  const aliases = {
    claude: new Map<string, InstalledTerminalSkill>(),
    codex: new Map<string, InstalledTerminalSkill>(),
  };
  for (const provider of ["claude", "codex"] as const) {
    for (const skill of skills) aliases[provider].set(skill.skillId, skill);
    for (const name of await names(resolve(root, `.${provider}/skills`))) {
      if (!SKILL_ID.test(name)) continue;
      const surface = resolve(root, `.${provider}/skills`, name);
      if (!(await lstat(surface)).isSymbolicLink()) continue;
      const actual = await realpath(resolve(surface, "SKILL.md")).catch(() => null);
      const skill = actual === null ? undefined : byRealPath.get(actual);
      if (
        skill !== undefined &&
        (!aliases[provider].has(name) || aliases[provider].get(name) === skill)
      )
        aliases[provider].set(name, skill);
    }
  }
  return { skills, resolve: (provider, identifier) => aliases[provider].get(identifier) };
}
