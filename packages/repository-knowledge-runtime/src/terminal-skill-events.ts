import type { EventDraftV7 } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";
import type { InstalledTerminalSkill } from "./terminal-installed-skills.js";
import type { QueuedTerminalSkillTurn } from "./terminal-skill-queue.js";

export const TERMINAL_SKILL_EVENT_SCHEMA_VERSION = 7;
export const terminalSkillEventId = (context: string, suffix: string) =>
  `evt_${sha256(`${context}\0${suffix}`).slice(7, 39)}`;

/** Reader activation owns publication. These drafts also feed the private, bounded projection. */
export function terminalSkillEvents(input: {
  storage: ProjectStorage;
  turn: QueuedTerminalSkillTurn;
  parent: { runId: string; sessionId: string; occurredAt: string };
  now: Date;
  observations: Array<
    InstalledTerminalSkill & { source: "provider_transcript" | "prompt_invocation" }
  >;
  skillTelemetry: "observed" | "unavailable" | "truncated" | "unknown";
  externalSkillCount: number;
  unknownSkillCount: number;
  ambiguousSkillCount: number;
}): EventDraftV7[] {
  const { turn, parent } = input;
  const coordinates = {
    providerSessionDigest: turn.providerSessionDigest,
    providerTurnDigest: turn.providerTurnDigest,
    observedAt: parent.occurredAt,
  };
  const envelope = {
    projectId: input.storage.manifest.projectId,
    runId: parent.runId,
    sessionId: parent.sessionId,
    occurredAt: input.now.toISOString(),
    actor: { kind: "system" as const },
    schemaVersion: TERMINAL_SKILL_EVENT_SCHEMA_VERSION as 7,
    policyVersion: sha256("lervo.terminal.native-skill-observation.v2"),
  };
  return [
    ...input.observations.map((skill, index): EventDraftV7 => ({
      ...envelope,
      eventId: terminalSkillEventId(turn.contextEventId, `invocation:${index}`),
      type: "terminal.skill.observed",
      payload: { ...coordinates, ...skill, provider: turn.provider },
    })),
    {
      ...envelope,
      eventId: terminalSkillEventId(turn.contextEventId, "assessed"),
      type: "terminal.skill.turn_assessed",
      payload: {
        ...coordinates,
        provider: turn.provider,
        skillTelemetry: input.skillTelemetry,
        externalSkillCount: input.externalSkillCount,
        unknownSkillCount: input.unknownSkillCount,
        ambiguousSkillCount: input.ambiguousSkillCount,
      },
    },
  ];
}
