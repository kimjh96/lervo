import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import type { EventEnvelope } from "@lervo/schemas";
import { assessPracticeUsage } from "../src/practice-usage.js";
import { observePracticeExposure } from "../src/practice-exposure.js";
import { projectPracticeVersionUsage } from "../src/practice-usage-projection.js";
import { readPracticeState } from "../src/practice-store.js";
import { settlePracticeAssessment } from "../src/practice-assessment.js";
import { practice, practiceContext, work } from "./practice-fixture.js";

const mocks = vi.hoisted(() => ({ review: vi.fn(), retire: vi.fn() }));
vi.mock("../src/practice-usage-review.js", () => ({ reviewPracticeUsage: mocks.review }));
vi.mock("../src/practice-retirement.js", () => ({ retirePracticeSkill: mocks.retire }));
vi.mock("../src/convergence-owner-host.js", () => ({ readConvergenceOwnerHost: async () => null }));
vi.mock("../src/knowledge-publication-state.js", () => ({
  readKnowledgePublicationState: async () => null,
}));
vi.mock("../src/delegation.js", () => ({
  loadConvergenceDelegation: async () => ({
    delegation: { integrationTarget: { ref: "integration" } },
  }),
}));
vi.mock("../src/integration-target-sync.js", () => ({
  resolveIntegrationTarget: async () => "integration",
}));
vi.mock("../src/terminal-skill-revision-files.js", () => ({
  terminalSkillRevisionFiles: async () => ({ read: async () => Buffer.from("generated version") }),
}));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.review.mockResolvedValue("keep");
});
function generated() {
  return {
    name: practice.name,
    path: `.agents/skills/${practice.name}/SKILL.md`,
    versionHash: sha256("generated version"),
    candidateId: "candidate",
    commit: "commit",
    exposedAt: null,
    reevaluatedAt: null,
  };
}
function turn(index: number, at: string): EventEnvelope[] {
  const common = {
    schemaVersion: 7 as const,
    projectId: "prj_practice_fixture",
    actor: { kind: "system" as const },
    policyVersion: sha256("policy"),
    previousHash: null,
    eventHash: sha256(`event-${index}`),
    eventId: `evt_${index}`,
    runId: `run_${index}`,
    sessionId: `ses_${index}`,
    occurredAt: at,
  };
  const coordinates = {
    providerSessionDigest: sha256(`session-${index}`),
    providerTurnDigest: sha256(`turn-${index}`),
  };
  return [
    { ...common, seq: index * 2 + 1, type: "terminal.turn.observed", payload: coordinates },
    {
      ...common,
      seq: index * 2 + 2,
      eventId: `evt_assessed_${index}`,
      type: "terminal.skill.turn_assessed",
      payload: {
        ...coordinates,
        observedAt: at,
        provider: "claude",
        skillTelemetry: "observed",
        unknownSkillCount: 0,
        ambiguousSkillCount: 0,
      },
    },
  ];
}
describe("load-based exposure through unused-skill review", () => {
  it("reaches thirty-day, twenty-turn re-evaluation from target presence and a later observed turn without invocation", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "practice-exposure-"));
    roots.push(root);
    const base = practiceContext(root);
    let at = new Date("2026-09-01T00:00:00Z");
    let events: EventEnvelope[] = [];
    const context = {
      ...base,
      now: () => at,
      storage: {
        ...base.storage,
        events: {
          ...base.storage.events,
          list: (query?: { afterSeq?: number }) => (query?.afterSeq ? [] : events),
        },
      },
    };
    const state = await readPracticeState(root);
    await settlePracticeAssessment({ context, state, work, value: practice, readRoots: ["*"] });
    const candidate = state.candidates[0]!;
    candidate.observedAt = "2026-08-31T00:00:00Z";
    candidate.state = "published";
    candidate.drafterAgentId = "generator";
    candidate.drafterSessionId = "generator-session";
    const skill = { ...generated(), candidateId: candidate.candidateId };
    state.generated.push(skill);
    await assessPracticeUsage(context, state, "write");
    expect(skill.exposedAt).toBeNull();
    at = new Date("2026-09-02T00:00:00Z");
    events = turn(0, at.toISOString());
    await assessPracticeUsage(context, state, "write");
    expect(skill.exposedAt).toBe(at.toISOString());
    expect(candidate.state).toBe("exposed");
    at = new Date("2026-10-31T00:00:00Z");
    events.push(
      ...Array.from({ length: 19 }, (_, i) => turn(i + 1, "2026-10-30T00:00:00Z")).flat(),
    );
    const usage = projectPracticeVersionUsage({
      skill,
      events,
      now: at,
      allHostsObserved: true,
      generated: true,
    });
    expect(usage).toMatchObject({
      usageState: "unused_with_coverage",
      observedTurns: 20,
      nativeInvocations: 0,
      managedInvocations: 0,
      reevaluate: true,
    });
    await assessPracticeUsage(context, state, "write");
    expect(mocks.review).toHaveBeenCalledOnce();
    expect(mocks.retire).not.toHaveBeenCalled();
    expect(skill.reevaluatedAt).toBe(at.toISOString());
  });
  it("accepts exact provider load evidence and never treats selection or invocation as exposure", () => {
    const skill = generated();
    const event = {
      occurredAt: "2026-09-01T00:00:00Z",
      payload: {
        capabilityKind: "skill",
        capabilityId: skill.name,
        contentHash: skill.versionHash,
      },
    };
    for (const type of ["capability.selected", "skill.invoked", "terminal.skill.observed"] as const)
      observePracticeExposure({
        skill,
        present: false,
        events: [{ ...event, type }],
        notBefore: "2026-08-31T00:00:00Z",
        now: new Date("2026-09-02T00:00:00Z"),
      });
    expect(skill.exposedAt).toBeNull();
    observePracticeExposure({
      skill,
      present: false,
      events: [
        {
          ...event,
          type: "capability.loaded",
          payload: { ...event.payload, contentHash: sha256("older version") },
        },
      ],
      notBefore: "2026-08-31T00:00:00Z",
      now: new Date("2026-09-02T00:00:00Z"),
    });
    expect(skill.exposedAt).toBeNull();
    observePracticeExposure({
      skill,
      present: false,
      events: [{ ...event, type: "capability.loaded" }],
      notBefore: "2026-08-31T00:00:00Z",
      now: new Date("2026-09-02T00:00:00Z"),
    });
    expect(skill.exposedAt).toBe(event.occurredAt);
  });
});
