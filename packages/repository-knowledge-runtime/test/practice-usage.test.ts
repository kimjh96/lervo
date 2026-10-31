import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@lervo/schemas";
import { sha256 } from "@lervo/repository-knowledge";
import { projectPracticeVersionUsage } from "../src/practice-usage-projection.js";

const skill = {
  name: "quarterly-release",
  path: ".agents/skills/quarterly-release/SKILL.md",
  versionHash: sha256("v1"),
  exposedAt: "2026-09-01T00:00:00Z",
};
const now = new Date("2026-10-31T12:00:00Z");
function event(type: EventEnvelope["type"], index: number, payload: Record<string, unknown>) {
  return {
    type,
    eventId: `evt_${index}_${type}`,
    runId: `run_${index}`,
    sessionId: `ses_${index}`,
    occurredAt: "2026-10-30T00:00:00Z",
    payload,
  };
}
const observed = Array.from({ length: 20 }, (_, i) => [
  event("terminal.turn.observed", i, {
    providerSessionDigest: sha256(`s${i}`),
    providerTurnDigest: sha256(`t${i}`),
  }),
  event("terminal.skill.turn_assessed", i, {
    providerSessionDigest: sha256(`s${i}`),
    providerTurnDigest: sha256(`t${i}`),
    observedAt: "2026-10-30T00:00:00Z",
    provider: "claude",
    skillTelemetry: "observed",
    unknownSkillCount: 0,
    ambiguousSkillCount: 0,
  }),
]).flat();
describe("version exposure and conservative skill usage", () => {
  it("requests review after thirty days and twenty fully observed turns, rather than deleting", () => {
    const usage = projectPracticeVersionUsage({
      skill,
      events: observed,
      now,
      allHostsObserved: true,
      generated: true,
    });
    expect(usage).toMatchObject({
      usageState: "unused_with_coverage",
      reevaluate: true,
      observedTurns: 20,
    });
    expect(usage).not.toHaveProperty("delete");
  });
  it.each(["host", "codex", "missing_turn", "no_exposure", "conversation"])(
    "never retires unknown %s coverage",
    (gap) => {
      const events = [...observed];
      if (gap === "codex")
        events[1] = {
          ...events[1]!,
          payload: { ...events[1]!.payload, provider: "codex", skillTelemetry: "unknown" },
        };
      if (gap === "missing_turn") events.pop();
      if (gap === "conversation")
        events.push(event("conversation.repository_work.completed", 100, {}));
      expect(
        projectPracticeVersionUsage({
          skill: gap === "no_exposure" ? { ...skill, exposedAt: null } : skill,
          events,
          now,
          allHostsObserved: gap !== "host",
          generated: true,
        }),
      ).toMatchObject({ usageState: "unknown", reevaluate: false });
    },
  );
  it("does not attribute another version's invocation to the current skill", () => {
    const events = [
      ...observed,
      event("terminal.skill.observed", 21, {
        path: skill.path,
        skillId: skill.name,
        contentHash: sha256("old-version"),
        observedAt: "2026-10-30T00:00:00Z",
      }),
    ];
    expect(
      projectPracticeVersionUsage({ skill, events, now, allHostsObserved: true, generated: true })
        .usageState,
    ).toBe("unused_with_coverage");
  });
  it("keeps managed and native invocation evidence levels distinct", () => {
    const events = [
      ...observed,
      event("skill.resolved", 21, {
        skillId: skill.name,
        version: "1.0.0",
        contentHash: skill.versionHash,
      }),
      event("skill.invoked", 21, { skillId: skill.name, version: "1.0.0" }),
    ];
    expect(
      projectPracticeVersionUsage({ skill, events, now, allHostsObserved: true, generated: true }),
    ).toMatchObject({
      usageState: "used",
      nativeInvocations: 0,
      managedInvocations: 1,
      reevaluate: false,
    });
  });
  it("reports a hand-written skill only as health information after ninety days", () => {
    expect(
      projectPracticeVersionUsage({
        skill,
        events: observed,
        now,
        allHostsObserved: true,
        generated: false,
      }),
    ).toMatchObject({ reevaluate: false, healthItem: false });
    expect(
      projectPracticeVersionUsage({
        skill: { ...skill, exposedAt: "2026-07-01T00:00:00Z" },
        events: observed,
        now,
        allHostsObserved: true,
        generated: false,
      }),
    ).toMatchObject({ reevaluate: false, healthItem: true });
  });
});
