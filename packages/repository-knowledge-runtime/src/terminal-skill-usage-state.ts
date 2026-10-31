import { resolve } from "node:path";
import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";
import type { InstalledTerminalSkill } from "./terminal-installed-skills.js";
import {
  projectTerminalSkillUsage,
  type TerminalSkillUsageProjection,
} from "./terminal-skill-projection.js";

export const TERMINAL_SKILL_USAGE_PATH = ".lervo/state/knowledge/terminal-skills/usage.json";

export async function readTerminalSkillUsage(
  root: string,
): Promise<TerminalSkillUsageProjection | null> {
  const result = await readPrivateJsonFile(
    resolve(root, TERMINAL_SKILL_USAGE_PATH),
    2 * 1024 * 1024,
  );
  if (result.status !== "read") return null;
  const value = result.value as TerminalSkillUsageProjection | null;
  return value?.schemaVersion === 1 &&
    Number.isFinite(Date.parse(value.projectedAt)) &&
    Array.isArray(value.skills) &&
    value.skills.length <= 1024
    ? value
    : null;
}

/** One current bounded projection. History is rebuilt from the canonical event log. */
export async function refreshTerminalSkillUsage(
  storage: ProjectStorage,
  skills: InstalledTerminalSkill[],
  now: Date,
): Promise<void> {
  const previous = await readTerminalSkillUsage(storage.paths.repositoryRoot);
  if (previous?.projectedAt.slice(0, 10) === now.toISOString().slice(0, 10)) return;
  const events: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    const batch = storage.events.list({ afterSeq, limit: 1000 });
    if (batch.length === 0) break;
    for (const event of batch)
      if (
        (event.type === "terminal.skill.observed" ||
          event.type === "terminal.skill.turn_assessed") &&
        Date.parse(String(event.payload.observedAt)) >= now.getTime() - 30 * 86_400_000 &&
        Date.parse(String(event.payload.observedAt)) <= now.getTime()
      )
        events.push(event);
    afterSeq = batch.at(-1)!.seq;
  }
  await writePrivateJsonFile(
    resolve(storage.paths.repositoryRoot, TERMINAL_SKILL_USAGE_PATH),
    projectTerminalSkillUsage({ skills, events, now }),
  );
}
