import { privateTerminalSkillTurns } from "./terminal-skill-private.js";
import { resolve } from "node:path";
import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import type { EventEnvelope } from "@lervo/schemas";
import { latestEventHash } from "@lervo/storage-contract";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";
import {
  readTerminalSkillUsageCursor,
  writeTerminalSkillUsageCursor,
} from "./terminal-skill-usage-cursor.js";
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
const WINDOW_MILLISECONDS = 30 * 86_400_000;

/**
 * One current bounded projection. History is rebuilt from the canonical event log. ADR-0597: the
 * projection is skipped while its inputs (event head, UTC day, installed skills) are unchanged,
 * and the log is read only from the last skill event before the 30-day window onwards.
 * `force` rebuilds it after this cycle retained private turns, which append no event.
 */
export async function refreshTerminalSkillUsage(
  storage: ProjectStorage,
  skills: InstalledTerminalSkill[],
  now: Date,
  options: { force?: boolean } = {},
): Promise<void> {
  const root = storage.paths.repositoryRoot;
  const sourceKey = sha256(
    canonicalJson({
      head: latestEventHash(storage.events),
      day: now.toISOString().slice(0, 10),
      skills,
    }),
  );
  const cursor = await readTerminalSkillUsageCursor(root, storage.events);
  if (
    options.force !== true &&
    cursor?.sourceKey === sourceKey &&
    (await readTerminalSkillUsage(root)) !== null
  )
    return;
  const windowStart = now.getTime() - WINDOW_MILLISECONDS;
  let anchor = cursor?.anchor ?? null;
  let inWindow = false;
  const events: EventEnvelope[] = [];
  let afterSeq = anchor?.seq ?? 0;
  while (true) {
    // ADR-0554: a typed read costs only the skill events, never the length of history.
    const batch = storage.events.list({ afterSeq, limit: 1000, types: skillUsageEventTypes });
    if (batch.length === 0) break;
    for (const event of batch) {
      const at = Date.parse(String(event.payload.observedAt));
      if (!inWindow && !(at >= windowStart)) anchor = { seq: event.seq, eventId: event.eventId };
      else inWindow = true;
      if (
        (event.type === "terminal.skill.observed" ||
          event.type === "terminal.skill.turn_assessed") &&
        at >= windowStart &&
        at <= now.getTime()
      )
        events.push(event);
    }
    afterSeq = batch.at(-1)!.seq;
  }
  await writePrivateJsonFile(
    resolve(root, TERMINAL_SKILL_USAGE_PATH),
    projectTerminalSkillUsage({
      skills,
      events: [
        ...new Map(
          [
            ...(await privateTerminalSkillTurns(root, now)).flatMap((turn) =>
              turn.events.filter((event) => event.type === "terminal.skill.observed"),
            ),
            ...events,
          ].map((event) => [event.eventId, event]),
        ).values(),
      ],
      now,
    }),
  );
  await writeTerminalSkillUsageCursor(root, { schemaVersion: 1, sourceKey, anchor });
}
