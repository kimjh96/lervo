import type { EventEnvelope } from "@lervo/schemas";
import type { InstalledTerminalSkill } from "./terminal-installed-skills.js";

const WINDOW_MS = 30 * 86_400_000;

export interface TerminalSkillUsageProjection {
  schemaVersion: 1;
  projectedAt: string;
  windowStart: string;
  observedTurnCount: number;
  unavailableTurnCount: number;
  truncatedTurnCount: number;
  assessmentEventIds: string[];
  skills: Array<
    InstalledTerminalSkill & {
      observedInvocationCount: number;
      retirementCandidate: boolean;
      reviewOwner: "principal_proxy";
      evidenceEventIds: string[];
    }
  >;
}

/** A usage proxy, never proof that a skill body was followed or authority to remove it. */
export function projectTerminalSkillUsage(input: {
  skills: readonly InstalledTerminalSkill[];
  events: readonly EventEnvelope[];
  now: Date;
}): TerminalSkillUsageProjection {
  const end = input.now.getTime();
  const start = end - WINDOW_MS;
  const events = input.events.filter((event) => {
    const at = Date.parse(String(event.payload.observedAt));
    return at >= start && at <= end;
  });
  const assessed = events.filter((event) => event.type === "terminal.skill.turn_assessed");
  const observed = assessed.filter((event) => event.payload.skillTelemetry === "observed");
  return {
    schemaVersion: 1,
    projectedAt: input.now.toISOString(),
    windowStart: new Date(start).toISOString(),
    observedTurnCount: observed.length,
    unavailableTurnCount: assessed.filter((event) => event.payload.skillTelemetry === "unavailable")
      .length,
    truncatedTurnCount: assessed.filter((event) => event.payload.skillTelemetry === "truncated")
      .length,
    assessmentEventIds: observed.slice(-20).map((event) => event.eventId),
    skills: input.skills.map((skill) => {
      const invocations = events.filter(
        (event) =>
          event.type === "terminal.skill.observed" &&
          event.payload.skillId === skill.skillId &&
          event.payload.path === skill.path,
      );
      return {
        ...skill,
        observedInvocationCount: invocations.length,
        retirementCandidate: observed.length >= 20 && invocations.length === 0,
        reviewOwner: "principal_proxy",
        evidenceEventIds: invocations.slice(-20).map((event) => event.eventId),
      };
    }),
  };
}
