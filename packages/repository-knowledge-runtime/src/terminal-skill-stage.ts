import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { sha256 } from "@lervo/repository-knowledge";
import {
  installedTerminalSkills,
  type InstalledTerminalSkill,
} from "./terminal-installed-skills.js";
import {
  queuedTerminalSkillTurns,
  removeTerminalSkillTurn,
  type QueuedTerminalSkillTurn,
} from "./terminal-skill-queue.js";
import { assessTerminalSkillTranscript } from "./terminal-skill-transcript.js";
import { refreshTerminalSkillUsage } from "./terminal-skill-usage-state.js";

const POLICY = sha256("lervo.terminal.native-skill-observation.v1");
const identity = (context: string, suffix: string) =>
  `evt_${sha256(`${context}\0${suffix}`).slice(7, 39)}`;

function matches(
  turn: QueuedTerminalSkillTurn,
  event: EventEnvelope | null,
): event is EventEnvelope {
  return (
    event !== null &&
    event.payload.providerSessionDigest === turn.providerSessionDigest &&
    event.payload.providerTurnDigest === turn.providerTurnDigest &&
    event.actor.provider === turn.provider
  );
}

/** Runs under the resident worker lock on every host, before any provider or convergence stage. */
export async function runTerminalSkillObservationCycle(input: {
  storage: ProjectStorage;
  now: Date;
}): Promise<{ assessedCount: number }> {
  const { storage, now } = input;
  const root = storage.paths.repositoryRoot;
  const queue = await queuedTerminalSkillTurns(root, now);
  const catalog = await installedTerminalSkills(root).catch(() => null);
  let assessedCount = 0;
  for (const turn of queue.slice(0, 4)) {
    const assessedId = identity(turn.contextEventId, "assessed");
    if (storage.events.get(assessedId) !== null) {
      await removeTerminalSkillTurn(root, turn.contextEventId);
      continue;
    }
    const parent = storage.events.get(turn.turnEventId);
    const context = storage.events.get(turn.contextEventId);
    if (
      !matches(turn, parent) ||
      parent.type !== "terminal.turn.observed" ||
      parent.payload.contextEventId !== turn.contextEventId ||
      !matches(turn, context) ||
      context.type !== "terminal.context.prepared"
    ) {
      await removeTerminalSkillTurn(root, turn.contextEventId);
      continue;
    }
    const assessment =
      catalog === null
        ? { skillTelemetry: "unavailable" as const, identifiers: [] }
        : await assessTerminalSkillTranscript(turn);
    const observations: Array<
      InstalledTerminalSkill & { source: "provider_transcript" | "prompt_invocation" }
    > = [];
    let externalSkillCount = 0;
    for (const identifier of assessment.identifiers) {
      const skill = catalog?.resolve(turn.provider, identifier);
      if (skill === undefined) externalSkillCount++;
      else observations.push({ ...skill, source: "provider_transcript" });
    }
    if (Array.isArray(context.payload.selectedPointers)) {
      for (const pointer of context.payload.selectedPointers as Array<{
        kind?: unknown;
        path?: unknown;
        contentHash?: unknown;
      }>) {
        if (pointer.kind !== "skill") continue;
        const skill = catalog?.skills.find(
          (item) => item.path === pointer.path && item.contentHash === pointer.contentHash,
        );
        if (skill !== undefined) observations.push({ ...skill, source: "prompt_invocation" });
      }
    }
    const coordinates = {
      providerSessionDigest: turn.providerSessionDigest,
      providerTurnDigest: turn.providerTurnDigest,
      observedAt: parent.occurredAt,
    };
    const envelope = {
      projectId: storage.manifest.projectId,
      runId: parent.runId,
      sessionId: parent.sessionId,
      occurredAt: now.toISOString(),
      actor: { kind: "system" as const },
      schemaVersion: 1 as const,
      policyVersion: POLICY,
    };
    storage.events.transact((transaction) => {
      observations.forEach((skill, index) =>
        transaction.append({
          ...envelope,
          eventId: identity(turn.contextEventId, `invocation:${index}`),
          type: "terminal.skill.observed",
          payload: { ...coordinates, ...skill, provider: turn.provider },
        }),
      );
      transaction.append({
        ...envelope,
        eventId: assessedId,
        type: "terminal.skill.turn_assessed",
        payload: { ...coordinates, skillTelemetry: assessment.skillTelemetry, externalSkillCount },
      });
    });
    await removeTerminalSkillTurn(root, turn.contextEventId);
    assessedCount++;
  }
  if (catalog !== null) await refreshTerminalSkillUsage(storage, catalog.skills, now);
  return { assessedCount };
}
