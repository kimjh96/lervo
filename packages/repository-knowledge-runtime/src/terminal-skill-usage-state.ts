import { privateTerminalSkillTurns } from "./terminal-skill-private.js";
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

const skillUsageEventTypes = ["terminal.skill.observed", "terminal.skill.turn_assessed"];

/** One current bounded projection. History is rebuilt from the canonical event log. */
export async function refreshTerminalSkillUsage(
  storage: ProjectStorage,
  skills: InstalledTerminalSkill[],
  now: Date,
): Promise<void> {
  const events: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    // ADR-0554: a typed read costs only the skill events, never the length of history.
    const batch = storage.events.list({ afterSeq, limit: 1000, types: skillUsageEventTypes });
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
    projectTerminalSkillUsage({
      skills,
      events: [
        ...new Map(
          [
            ...(await privateTerminalSkillTurns(storage.paths.repositoryRoot, now)).flatMap(
              (turn) => turn.events.filter((event) => event.type === "terminal.skill.observed"),
            ),
            ...events,
          ].map((event) => [event.eventId, event]),
        ).values(),
      ],
      now,
    }),
  );
}
