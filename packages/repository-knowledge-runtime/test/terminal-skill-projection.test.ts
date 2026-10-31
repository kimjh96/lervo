import { expect, it } from "vitest";
import type { EventEnvelope } from "@lervo/schemas";
import { sha256 } from "@lervo/repository-knowledge";
import { projectTerminalSkillUsage } from "../src/terminal-skill-projection.js";

const now = new Date("2026-10-31T12:00:00.000Z");
const skill = {
  skillId: "eli5",
  path: ".agents/skills/eli5/SKILL.md",
  contentHash: sha256("skill"),
};
function event(
  index: number,
  type: "terminal.skill.observed" | "terminal.skill.turn_assessed",
  payload: Record<string, unknown>,
  observedAt = now.toISOString(),
): EventEnvelope {
  return {
    eventId: `evt_${index.toString().padStart(24, "0")}`,
    seq: index + 1,
    projectId: "prj_skillusage01",
    runId: "run_skillusage01",
    sessionId: "ses_skillusage01",
    type,
    actor: { kind: "system" },
    schemaVersion: 1,
    occurredAt: now.toISOString(),
    policyVersion: sha256("policy"),
    previousHash: index === 0 ? null : sha256("previous"),
    eventHash: sha256(String(index)),
    payload: {
      providerSessionDigest: sha256("session"),
      providerTurnDigest: null,
      observedAt,
      ...payload,
    },
  };
}
const turns = (count: number, skillTelemetry = "observed") =>
  Array.from({ length: count }, (_, i) =>
    event(i, "terminal.skill.turn_assessed", { skillTelemetry, externalSkillCount: 0 }),
  );

it("marks zero invocations after 20 observed turns as a principal proxy retirement candidate", () => {
  const report = projectTerminalSkillUsage({ skills: [skill], events: turns(20), now });
  expect(report.observedTurnCount).toBe(20);
  expect(report.skills[0]).toMatchObject({
    observedInvocationCount: 0,
    retirementCandidate: true,
    reviewOwner: "principal_proxy",
  });
  expect(report.assessmentEventIds).toHaveLength(20);
});

it("requires 20 measurable turns and never interprets unavailable or truncated transcripts as zero use", () => {
  for (const events of [turns(19), turns(25, "unavailable"), turns(25, "truncated")]) {
    expect(
      projectTerminalSkillUsage({ skills: [skill], events, now }).skills[0]!.retirementCandidate,
    ).toBe(false);
  }
});

it("counts both invocation sources, ignores old and future evidence, and bounds retained evidence IDs", () => {
  const within = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const old = new Date(Date.parse(within) - 1).toISOString();
  const future = new Date(now.getTime() + 1).toISOString();
  for (const source of ["prompt_invocation", "provider_transcript"]) {
    const report = projectTerminalSkillUsage({
      skills: [skill],
      events: [
        ...turns(25),
        event(30, "terminal.skill.observed", { ...skill, source, provider: "claude" }, within),
      ],
      now,
    });
    expect(report.skills[0]).toMatchObject({
      retirementCandidate: false,
      observedInvocationCount: 1,
    });
    expect(report.assessmentEventIds).toHaveLength(20);
    expect(report.skills[0]!.evidenceEventIds).toHaveLength(1);
  }
  const report = projectTerminalSkillUsage({
    skills: [skill],
    events: [
      ...turns(20),
      event(30, "terminal.skill.observed", { ...skill }, old),
      event(31, "terminal.skill.observed", { ...skill }, future),
    ],
    now,
  });
  expect(report.skills[0]!.retirementCandidate).toBe(true);
});
