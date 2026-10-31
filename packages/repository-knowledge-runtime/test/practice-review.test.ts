import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import { draftOrReviewPractice } from "../src/practice-draft.js";
import { materializePractice, createPracticeClaudeLink } from "../src/practice-materialization.js";
import { settlePracticeAssessment } from "../src/practice-assessment.js";
import { readPracticeState, writePracticeState } from "../src/practice-store.js";
import { practice, practiceContext, work, now } from "./practice-fixture.js";

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
vi.mock("../src/convergence-owner-fence.js", () => ({
  knowledgeOutputCommitGrant: async () => ({ allowed: true, hostHash: null }),
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
    readablePaths: [],
    skills: [],
    rules: [],
  });
});
async function setup(observed = work, readRoots = ["*"], readablePaths: string[] = []) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-practice-review-"));
  roots.push(root);
  const context = practiceContext(root);
  const state = await readPracticeState(root);
  await settlePracticeAssessment({
    context,
    state,
    work: observed,
    value: practice,
    readRoots,
    readablePaths,
  });
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
        readablePaths: [],
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

  it("never reintroduces assessment-excluded paths, hashes or reply lines into drafting and review", async () => {
    const excludedHash = sha256("excluded content");
    const { context, state, candidate } = await setup(
      {
        ...work,
        reply: "Read src/visible.ts.\nRead excluded/hidden.ts.",
        changedFiles: [{ path: "excluded/hidden.ts", before: null, after: excludedHash }],
        steps: [{ ...work.steps[0]!, paths: ["src/visible.ts", "excluded/hidden.ts"] }],
      },
      ["src"],
      ["src/visible.ts"],
    );
    mocks.catalog.mockResolvedValue({
      complete: true,
      digest: sha256("catalog"),
      readRoots: ["src"],
      readablePaths: ["src/visible.ts"],
      skills: [],
      rules: [],
    });
    mocks.call.mockImplementation(async (input) => {
      const disclosed = canonicalJson(input.data);
      expect(disclosed).not.toContain("excluded/hidden.ts");
      expect(disclosed).not.toContain(excludedHash);
      expect(input.data.evidence[0].evidenceHash).toBe(state.evidence[0]!.evidenceHash);
      return input.kind === "draft"
        ? { overlap: "new", targetSkill: null, practice }
        : { ...input.data.binding, decision: "accept", reasonCode: "accepted" };
    });
    await draftOrReviewPractice(context, state, candidate);
    await draftOrReviewPractice(context, state, candidate);
    expect(mocks.call).toHaveBeenCalledTimes(2);
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

  it.each(["assessed", "drafted"] as const)(
    "rechecks current read scope before %s disclosure",
    async (stage) => {
      const { context, state, candidate } = await setup();
      if (stage === "drafted") {
        mocks.call.mockResolvedValue({ overlap: "new", targetSkill: null, practice });
        await draftOrReviewPractice(context, state, candidate);
        mocks.call.mockClear();
      }
      mocks.catalog.mockResolvedValue({
        complete: true,
        digest: sha256("catalog"),
        readRoots: [],
        readablePaths: [],
        skills: [],
        rules: [],
      });
      // A formerly allowed work path is retained in the exact evidence, not re-hashed on revocation.
      const evidence = state.evidence[0]!;
      evidence.work.steps[0]!.paths = ["src/previously-readable.ts"];
      const { evidenceHash: _hash, ...bundle } = evidence;
      evidence.evidenceHash = sha256(canonicalJson(bundle));
      candidate.evidenceHashes = [evidence.evidenceHash];
      await expect(draftOrReviewPractice(context, state, candidate)).rejects.toThrow(
        "source_incomplete",
      );
      expect(mocks.call).not.toHaveBeenCalled();
    },
  );

  it("retains accepted evidence through persistence and re-reviews after a catalog change", async () => {
    const { root, context, state, candidate } = await setup();
    mocks.call.mockImplementation(async (input) =>
      input.kind === "draft"
        ? { overlap: "new", targetSkill: null, practice }
        : { ...input.data.binding, decision: "accept", reasonCode: "accepted" },
    );
    await draftOrReviewPractice(context, state, candidate);
    await draftOrReviewPractice(context, state, candidate);
    const hashes = [...candidate.evidenceHashes];
    await writePracticeState(root, state, now);
    const resumed = await readPracticeState(root);
    const accepted = resumed.candidates[0]!;
    expect(resumed.evidence).toHaveLength(1);
    mocks.catalog.mockResolvedValue({
      complete: true,
      digest: sha256("changed catalog"),
      readRoots: ["*"],
      readablePaths: [],
      skills: [],
      rules: [],
    });
    await expect(materializePractice(context, resumed, accepted)).rejects.toThrow("review_invalid");
    expect(accepted.state).toBe("assessed");
    expect(accepted.evidenceHashes).toEqual(hashes);
    await draftOrReviewPractice(context, resumed, accepted);
    await draftOrReviewPractice(context, resumed, accepted);
    expect(accepted.state).toBe("reviewed_accepted");
    expect(accepted.review!.catalogDigest).toBe(sha256("changed catalog"));
    expect(accepted.review!.evidenceHashes).toEqual(hashes);
    expect(mocks.call).toHaveBeenCalledTimes(4);
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
