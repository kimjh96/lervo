import { beforeEach, expect, it, vi } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";

import { reviewPracticeUsage } from "../src/practice-usage-review.js";
import type { PracticeState } from "../src/practice-state.js";
import { practiceContext } from "./practice-fixture.js";

const bytes = Buffer.from("---\nname: quarterly-release\n---\n");
const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../src/delegation.js", () => ({
  loadConvergenceDelegation: async () => ({ delegation: {} }),
}));
vi.mock("../src/source-file.js", () => ({ ordinaryConvergenceSourceBytes: () => bytes }));
vi.mock("../src/practice-catalog.js", () => ({
  loadPracticeCatalog: async () => ({
    complete: true,
    digest: sha256("catalog"),
    skills: [{ path: skill.path, contentHash: skill.versionHash }],
  }),
}));
vi.mock("../src/practice-events.js", () => ({ appendPracticeEvent: vi.fn() }));
vi.mock("../src/practice-provider-assignment.js", () => ({
  withPracticeProviderAssignment: async (input: {
    assertAuthority(authority: unknown): void;
    beforeCall(): Promise<void>;
    resolve(value: unknown, authority: unknown): unknown;
  }) => {
    const authority = {
      agent: { agentId: "reviewer" },
      assignment: { lease: { sessionId: "review-session" } },
    };
    input.assertAuthority(authority);
    await input.beforeCall();
    return input.resolve(await mocks.call(input), authority);
  },
}));

const skill = {
  name: "quarterly-release",
  path: ".agents/skills/quarterly-release/SKILL.md",
  versionHash: sha256(bytes),
  candidateId: "kprc_candidate",
  commit: "a".repeat(40),
  exposedAt: "2026-09-01T00:00:00Z",
  reevaluatedAt: null,
};
const usage = {
  usageState: "unused_with_coverage" as const,
  coverage: "complete" as const,
  observedTurns: 20,
  nativeInvocations: 0,
  managedInvocations: 0,
  lastObservedAt: null,
  reevaluate: true,
  healthItem: false,
};
const state = {
  candidates: [
    { candidateId: skill.candidateId, drafterAgentId: "drafter", drafterSessionId: "draft" },
  ],
  shapes: [],
} as unknown as PracticeState;

beforeEach(() => mocks.call.mockReset());

it("asks for keep or retire only and never shows a binding to echo (ADR-0604)", async () => {
  mocks.call.mockImplementationOnce(async (input) => {
    expect(Object.keys(input.schema.properties)).toEqual(["decision"]);
    expect(input.data).not.toHaveProperty("binding");
    expect(JSON.stringify(input.data)).not.toContain(skill.versionHash);
    return { decision: "retire" };
  });
  expect(await reviewPracticeUsage(practiceContext("/repo"), state, skill, usage)).toBe("retire");
});

it("throws on an answer that breaks the contract instead of reading it as a verdict", async () => {
  for (const answer of [
    { decision: "keep", draftHash: sha256("garbled") },
    { decision: "delete" },
    null,
  ]) {
    mocks.call.mockResolvedValueOnce(answer);
    await expect(
      reviewPracticeUsage(practiceContext("/repo"), state, skill, usage),
    ).rejects.toMatchObject({ code: "knowledge_semantic_review_invalid" });
  }
});
