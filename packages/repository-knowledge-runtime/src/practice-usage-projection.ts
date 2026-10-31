import type { EventEnvelope } from "@lervo/schemas";
import { projectTerminalSkillUsage } from "./terminal-skill-projection.js";

type UsageEvent = Pick<
  EventEnvelope,
  "type" | "eventId" | "payload" | "runId" | "sessionId" | "occurredAt"
>;
export interface PracticeVersionUsage {
  usageState: "used" | "unused_with_coverage" | "unknown";
  coverage: "complete" | "unknown";
  observedTurns: number;
  nativeInvocations: number;
  managedInvocations: number;
  lastObservedAt: string | null;
  reevaluate: boolean;
  healthItem: boolean;
}

/** Reuse ADR-0542 attribution while requiring exact version, exposure and every turn's coverage. */
export function projectPracticeVersionUsage(input: {
  skill: { name: string; path: string; versionHash: string; exposedAt: string | null };
  events: readonly UsageEvent[];
  now: Date;
  allHostsObserved: boolean;
  generated: boolean;
}): PracticeVersionUsage {
  const { skill } = input;
  const start = skill.exposedAt === null ? Infinity : Date.parse(skill.exposedAt);
  const events = input.events.filter(
    (e) => Date.parse(e.occurredAt) >= start && Date.parse(e.occurredAt) <= input.now.getTime(),
  );
  const native = events.filter(
    (e) =>
      e.type === "terminal.skill.observed" &&
      e.payload.path === skill.path &&
      e.payload.contentHash === skill.versionHash,
  );
  const managed = events.filter(
    (e) =>
      e.type === "skill.invoked" &&
      e.payload.skillId === skill.name &&
      events.some(
        (r) =>
          r.type === "skill.resolved" &&
          r.runId === e.runId &&
          r.sessionId === e.sessionId &&
          r.payload.skillId === e.payload.skillId &&
          r.payload.version === e.payload.version &&
          r.payload.contentHash === skill.versionHash,
      ),
  );
  const terminal = projectTerminalSkillUsage({
    skills: [{ skillId: skill.name, path: skill.path, contentHash: skill.versionHash }],
    events: events.filter(
      (e) => e.type !== "terminal.skill.observed" || e.payload.contentHash === skill.versionHash,
    ),
    now: input.now,
  });
  const turns = events.filter((e) => e.type === "terminal.turn.observed");
  const covered = turns.filter((e) =>
    events.some(
      (a) =>
        a.type === "terminal.skill.turn_assessed" &&
        a.runId === e.runId &&
        a.sessionId === e.sessionId &&
        a.payload.providerSessionDigest === e.payload.providerSessionDigest &&
        a.payload.providerTurnDigest === e.payload.providerTurnDigest &&
        a.payload.provider === "claude" &&
        a.payload.skillTelemetry === "observed" &&
        a.payload.unknownSkillCount === 0 &&
        a.payload.ambiguousSkillCount === 0,
    ),
  );
  const otherSurface = events.some(
    (e) => e.type === "conversation.repository_work.completed" || e.type === "run.requested",
  );
  const complete =
    start !== Infinity &&
    input.allHostsObserved &&
    !otherSurface &&
    turns.length > 0 &&
    covered.length === turns.length &&
    terminal.unknownTurnCount === 0 &&
    terminal.truncatedTurnCount === 0 &&
    terminal.unavailableTurnCount === 0;
  const usageState =
    native.length + managed.length ? "used" : complete ? "unused_with_coverage" : "unknown";
  const invocations = [...native, ...managed].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  );
  const age = input.now.getTime() - start;
  return {
    usageState,
    coverage: complete ? "complete" : "unknown",
    observedTurns: covered.length,
    nativeInvocations: native.length,
    managedInvocations: managed.length,
    lastObservedAt: invocations[0]?.occurredAt ?? null,
    reevaluate:
      input.generated &&
      usageState === "unused_with_coverage" &&
      age >= 30 * 86_400_000 &&
      covered.length >= 20,
    healthItem: !input.generated && usageState === "unused_with_coverage" && age >= 90 * 86_400_000,
  };
}
