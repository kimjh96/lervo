import type { EventEnvelope } from "@lervo/schemas";
import type { GeneratedPracticeSkill } from "./practice-state.js";

/** Loading and target presence establish exposure independently of invocation. */
export function observePracticeExposure(input: {
  skill: GeneratedPracticeSkill;
  present: boolean;
  events: readonly Pick<EventEnvelope, "type" | "payload" | "occurredAt">[];
  notBefore: string;
  now: Date;
}): void {
  const { skill } = input;
  if (skill.exposedAt !== null) return;
  skill.integrationObservedAt = input.present
    ? (skill.integrationObservedAt ?? input.now.toISOString())
    : null;
  const exposure = input.events
    .filter((event) => {
      const at = Date.parse(event.occurredAt);
      if (at < Date.parse(input.notBefore) || at > input.now.getTime()) return false;
      return (
        (event.type === "capability.loaded" &&
          event.payload.capabilityKind === "skill" &&
          event.payload.capabilityId === skill.name &&
          event.payload.contentHash === skill.versionHash) ||
        (input.present &&
          skill.integrationObservedAt !== null &&
          event.type === "terminal.turn.observed" &&
          at > Date.parse(skill.integrationObservedAt!))
      );
    })
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))[0];
  if (exposure) skill.exposedAt = exposure.occurredAt;
}
