import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { draftOrReviewPractice } from "../src/practice-draft.js";
import { materializePractice, createPracticeClaudeLink } from "../src/practice-materialization.js";
import { settlePracticeAssessment } from "../src/practice-assessment.js";
import { readPracticeState } from "../src/practice-store.js";
import { practice, practiceContext, work } from "./practice-fixture.js";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  catalog: vi.fn(),
  roots: [".agents/skills"],
  sameAgent: false,
}));
vi.mock("../src/practice-provider.js", () => ({ callPracticeProvider: mocks.call }));
vi.mock("../src/practice-catalog.js", () => ({ loadPracticeCatalog: mocks.catalog }));
vi.mock("../src/delegation.js", () => ({
  loadConvergenceDelegation: async () => ({
    contentHash: "delegation",
    delegation: { normalizationRoots: mocks.roots },
  }),
  assertConvergenceDelegation: async () => ({
    normalizationRoots: mocks.roots,
    canonicalRoots: [],
  }),
}));
vi.mock("../src/practice-assignment.js", () => ({
  withPracticeAssignment: async (input: {
    role: string;
    run(authority: unknown): Promise<unknown>;
  }) =>
    input.run({
      agent: { agentId: mocks.sameAgent ? "same-agent" : input.role },
      assignment: { lease: { sessionId: `session-${input.role}` } },
    }),
}));
vi.mock("../src/practice-scope.js", () => ({ requestPracticeWriteScope: vi.fn() }));

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  mocks.call.mockReset();
  mocks.roots = [".agents/skills"];
  mocks.sameAgent = false;
  mocks.catalog.mockResolvedValue({
    complete: true,
    digest: sha256("catalog"),
    readRoots: ["*"],
    skills: [],
    rules: [],
  });
});
async function setup() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-practice-review-"));
  roots.push(root);
  const context = practiceContext(root);
  const state = await readPracticeState(root);
  await settlePracticeAssessment({ context, state, work, value: practice, readRoots: ["*"] });
  return { root, context, state, candidate: state.candidates[0]! };
}

describe("practice comparison, independent review and authority", () => {
  it("already-covered work closes without writing a skill", async () => {
    const { context, state, candidate } = await setup();
    mocks.call.mockResolvedValue({ overlap: "already_covered", targetSkill: null, practice: null });
    await draftOrReviewPractice(context, state, candidate);
    expect(candidate).toMatchObject({
      state: "reviewed_rejected",
      reason: "duplicate",
      draft: null,
    });
    expect(state.funnel[0]!.drops["drafted:already_covered"]).toBe(1);
  });

  it.each([false, true])(
    "proposes partial overlap and preserves a hand-written or edited skill (owned=%s)",
    async (owned) => {
      const { root, context, state, candidate } = await setup();
      const path = `.agents/skills/${practice.name}/SKILL.md`;
      await mkdir(resolve(root, ".agents/skills", practice.name), { recursive: true });
      await writeFile(resolve(root, path), "Hand-written or edited skill.\n");
      mocks.catalog.mockResolvedValue({
        complete: true,
        digest: sha256("catalog"),
        readRoots: ["*"],
        skills: [
          {
            name: practice.name,
            path,
            contentHash: sha256("old-generated-bytes"),
            content: "Existing.",
            owned,
          },
        ],
        rules: [],
      });
      mocks.call.mockResolvedValueOnce({
        overlap: "partial_overlap",
        targetSkill: practice.name,
        practice,
      });
      await draftOrReviewPractice(context, state, candidate);
      mocks.call.mockImplementationOnce(async (input) => ({
        ...input.data.binding,
        decision: "accept",
        reasonCode: "accepted",
      }));
      await draftOrReviewPractice(context, state, candidate);
      if (owned)
        await expect(materializePractice(context, state, candidate)).rejects.toThrow(
          "target_changed",
        );
      else await materializePractice(context, state, candidate);
      expect(await readFile(resolve(root, path), "utf8")).toBe("Hand-written or edited skill.\n");
    },
  );

  it("retains conflict sources and waits unresolved", async () => {
    const { context, state, candidate } = await setup();
    mocks.call.mockResolvedValue({ overlap: "conflict", targetSkill: null, practice: null });
    await draftOrReviewPractice(context, state, candidate);
    await draftOrReviewPractice(context, state, candidate);
    expect(candidate.reason).toBe("conflict");
    expect(state.evidence).toHaveLength(1);
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });

  it("gives the independent reviewer the retained sanitized evidence and binds every hash", async () => {
    const { context, state, candidate } = await setup();
    mocks.call.mockResolvedValueOnce({ overlap: "new", targetSkill: null, practice });
    await draftOrReviewPractice(context, state, candidate);
    mocks.call.mockImplementationOnce(async (input) => {
      expect(input.data.evidence[0].evidenceHash).toBe(state.evidence[0]!.evidenceHash);
      expect(input.data.evidence[0].work.steps[0].outcome).toBe("passed");
      expect(input.data.binding).toMatchObject({
        draftHash: candidate.draftHash,
        evidenceHashes: candidate.evidenceHashes,
        targetHash: null,
        catalogDigest: candidate.catalogDigest,
      });
      return { ...input.data.binding, decision: "accept", reasonCode: "accepted" };
    });
    await draftOrReviewPractice(context, state, candidate);
    expect(candidate.review?.reviewerAgentId).not.toBe(candidate.drafterAgentId);
    expect(candidate.review?.reviewerSessionId).not.toBe(candidate.drafterSessionId);
    expect(candidate.state).toBe("reviewed_accepted");
  });

  it("refuses self-review before making the review call", async () => {
    const { context, state, candidate } = await setup();
    mocks.sameAgent = true;
    mocks.call.mockResolvedValue({ overlap: "new", targetSkill: null, practice });
    await draftOrReviewPractice(context, state, candidate);
    await expect(draftOrReviewPractice(context, state, candidate)).rejects.toThrow(
      "review_invalid",
    );
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });

  it("waits for missing write roots without writing the draft", async () => {
    const { root, context, state, candidate } = await setup();
    mocks.roots = ["docs"];
    candidate.state = "reviewed_accepted";
    await expect(materializePractice(context, state, candidate)).rejects.toThrow(
      "publication_authority_missing",
    );
    expect(candidate.reason).toBe("publication_authority_missing");
    await expect(
      readFile(resolve(root, ".agents/skills", practice.name, "SKILL.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates a Claude link only within scope and never replaces any existing entry", async () => {
    const { root } = await setup();
    expect(await createPracticeClaudeLink(root, practice.name, [".agents/skills"])).toBe(false);
    await mkdir(resolve(root, ".claude/skills"), { recursive: true });
    await writeFile(resolve(root, ".claude/skills", practice.name), "User entry.");
    expect(await createPracticeClaudeLink(root, practice.name, [".claude/skills"])).toBe(false);
    expect(await readFile(resolve(root, ".claude/skills", practice.name), "utf8")).toBe(
      "User entry.",
    );
    expect(await createPracticeClaudeLink(root, "new-skill", [".claude/skills"])).toBe(true);
  });
});
