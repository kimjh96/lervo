import { attributeTerminalSkills } from "./terminal-skill-attribution.js";
import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import {
  terminalSkillEvents,
  terminalSkillEventId,
  TERMINAL_SKILL_EVENT_SCHEMA_VERSION,
} from "./terminal-skill-events.js";
import { retainPrivateTerminalSkillTurn } from "./terminal-skill-private.js";
import { installedTerminalSkills } from "./terminal-installed-skills.js";
import {
  queuedTerminalSkillTurns,
  removeTerminalSkillTurn,
  type QueuedTerminalSkillTurn,
} from "./terminal-skill-queue.js";
import { readVerifiedTerminalTranscript } from "./terminal-skill-transcript.js";
import { transcriptSkillIdentifiers } from "./terminal-skill-transcript-adapters.js";
import { observePracticeWork } from "./practice-observation.js";
import { refreshTerminalSkillUsage } from "./terminal-skill-usage-state.js";

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
  const currentCatalog = await installedTerminalSkills(root).catch(() => null);
  let assessedCount = 0;
  for (const turn of queue.slice(0, 4)) {
    const assessedId = terminalSkillEventId(turn.contextEventId, "assessed");
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
    const catalog =
      turn.repositoryRevision === null
        ? null
        : await installedTerminalSkills(root, turn.repositoryRevision).catch(() => null);
    const transcript = await readVerifiedTerminalTranscript(turn);
    await observePracticeWork({ storage, turn, parent, transcript, now });
    const assessment =
      catalog === null || turn.provider === "codex"
        ? { skillTelemetry: "unknown" as const, identifiers: [] }
        : transcript.status === "observed"
          ? {
              skillTelemetry: "observed" as const,
              identifiers: transcript.entries.flatMap((entry) =>
                transcriptSkillIdentifiers(turn.provider, entry),
              ),
            }
          : { skillTelemetry: transcript.status, identifiers: [] };
    const attribution = attributeTerminalSkills({
      provider: turn.provider,
      catalog,
      assessment,
      selectedPointers: context.payload.selectedPointers,
    });
    const events = terminalSkillEvents({
      storage,
      turn,
      parent,
      now,
      ...attribution,
    });
    if ((storage.writableEventSchemaVersion ?? 1) >= TERMINAL_SKILL_EVENT_SCHEMA_VERSION) {
      storage.events.transact((transaction) => {
        for (const event of events) transaction.append(event);
      });
    } else {
      await retainPrivateTerminalSkillTurn(
        root,
        { contextEventId: turn.contextEventId, observedAt: parent.occurredAt, events },
        now,
      );
    }
    await removeTerminalSkillTurn(root, turn.contextEventId);
    assessedCount++;
  }
  if (currentCatalog !== null) await refreshTerminalSkillUsage(storage, currentCatalog.skills, now);
  return { assessedCount };
}
