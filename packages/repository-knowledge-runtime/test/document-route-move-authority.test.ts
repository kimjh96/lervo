import { afterEach, expect, it, vi } from "vitest";
import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { prepareConvergenceLifecycle } from "../src/lifecycle-prefix.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";

const HASH = "sha256:" + "a".repeat(64);
const calls = vi.hoisted(() => ({
  apply: vi.fn(async (_input: unknown) => ({ movedCount: 1 })),
  normalizationRoots: ["docs"],
  canonicalRoots: ["docs"],
  moves: [{ fromPath: "TRACE.md", toPath: "docs/operations/TRACE.md" }],
  references: [] as string[],
  status: "review_required" as "review_required" | "ready",
  review: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({
    planHash: "sha256:" + "b".repeat(64),
    reviewerAgentId: "reviewer",
    rationale: "approved",
  })),
  observe: vi.fn(async (_input: unknown) => {}),
  assignment: vi.fn((_input: unknown) => {}),
  commit: vi.fn(async (_input: unknown): Promise<unknown> => ({
    status: "committed",
    before: "1".repeat(40),
    after: "2".repeat(40),
  })),
  complete: vi.fn(async (_input: unknown) => ({ state: "current" })),
  waiting: vi.fn(async (_input: unknown) => ({ state: "attention_required" })),
  preflight: vi.fn(async (_root: string, _paths: readonly string[]): Promise<unknown> => null),
}));
vi.mock("@lervo/repository-knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lervo/repository-knowledge")>()),
  createKnowledgeInstructionBootstrapPlan: async () => ({ status: "not_applicable" }),
  createRepositoryLayoutMigrationPlan: async () => ({
    planKind: "repository_layout",
    planId: "klayout_trace",
    status: calls.status,
    deferredDocuments: [],
    deferredDocumentCount: 0,
    semanticClassificationIds: [],
    moves:
      calls.status === "ready"
        ? []
        : calls.moves.map((move, index) => ({
            ...move,
            operationId: `trace${index}`,
            approvalHash: HASH,
          })),
    userUpdates: [],
    referenceUpdates: calls.references.map((path) => ({ path })),
    operations: [
      ...calls.moves.map((move) => ({
        path: move.fromPath,
        destinationPath: move.toPath,
        action: "move",
        expectedCurrentHash: HASH,
      })),
      ...calls.references.map((path) => ({
        path,
        action: "update",
        ownership: "user",
        expectedCurrentHash: HASH,
      })),
    ],
  }),
  applyRepositoryLayoutMigrationPlan: calls.apply,
  lintRepositoryKnowledge: async () => ({ issues: [] }),
}));
vi.mock("../src/document-route-classification.js", () => ({
  classifyDeferredDocumentRoutes: async () => 0,
}));
vi.mock("../src/document-route-resolution-context.js", () => ({
  inspectDocumentRouteResolutionContext: async () => ({ providerAvailable: true }),
}));
vi.mock("../src/delegation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/delegation.js")>()),
  assertConvergenceDelegation: async () => ({
    canonicalRoots: calls.canonicalRoots,
    normalizationRoots: calls.normalizationRoots,
  }),
}));
vi.mock("../src/document-deferral-health.js", () => ({ observeDocumentDeferrals: calls.observe }));
vi.mock("../src/lifecycle-plan-review.js", () => ({ reviewLifecyclePlan: calls.review }));
vi.mock("../src/workforce.js", () => ({
  withConvergenceAssignment: async (input: { run(authority: unknown): Promise<unknown> }) => {
    calls.assignment(input);
    return input.run({
      agent: { agentId: "writer" },
      delegation: {
        canonicalRoots: calls.canonicalRoots,
        normalizationRoots: calls.normalizationRoots,
      },
      assertCurrent: async () => {},
    });
  },
}));
vi.mock("../src/knowledge-effect-commit.js", () => ({ commitKnowledgeEffect: calls.commit }));
vi.mock("../src/source-capture.js", () => ({ captureConvergenceSources: () => ({ sources: [] }) }));
vi.mock("../src/stage-receipt.js", () => ({
  completeConvergenceStage: calls.complete,
  waitingConvergenceStage: calls.waiting,
}));
vi.mock("../src/knowledge-effect-guard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/knowledge-effect-guard.js")>()),
  knowledgeEffectPreflight: calls.preflight,
}));
vi.mock("../src/convergence-parking.js", () => ({
  carriedParkedSources: async () => [],
  mergeParkedSources: (...lists: unknown[][]) => lists.flat(),
  obligationParkedSources: () => [],
  boundedReviewReasons: (reasons: string[]) => reasons,
}));
afterEach(() => {
  vi.clearAllMocks();
  calls.normalizationRoots = ["docs"];
  calls.canonicalRoots = ["docs"];
  calls.moves = [{ fromPath: "TRACE.md", toPath: "docs/operations/TRACE.md" }];
  calls.references = [];
  calls.status = "review_required";
});

const context = {
  storage: { paths: { repositoryRoot: "/fixture" }, artifacts: {} },
  assertSourceExact() {},
  assertSourceCurrent() {},
} as unknown as ConvergenceRuntimeContext;
const state = {
  baseline: { policyHash: HASH },
  stageData: {},
} as unknown as KnowledgeConvergenceInput;

it("reviews and applies an outside-root move with no owner command, then commits the notice", async () => {
  expect(await prepareConvergenceLifecycle(context, state, () => {})).toMatchObject({
    state: "current",
  });
  expect(calls.observe).toHaveBeenCalledWith(
    expect.objectContaining({
      layout: expect.objectContaining({ deferredDocuments: [], moves: [expect.anything()] }),
    }),
  );
  expect(calls.review).toHaveBeenCalledOnce();
  expect(calls.review.mock.calls[0]![4]).toEqual(["TRACE.md", "docs/operations/TRACE.md"]);
  expect(calls.assignment).toHaveBeenCalledWith(
    expect.objectContaining({ role: "writer", writeScope: "reviewed_plan" }),
  );
  expect(calls.apply).toHaveBeenCalledWith(
    expect.objectContaining({ itemBindings: [{ operationId: "trace0", approvalHash: HASH }] }),
  );
  expect(calls.commit).toHaveBeenCalledWith(
    expect.objectContaining({
      paths: ["TRACE.md", "docs/operations/TRACE.md"],
      notice: expect.objectContaining({
        effect: "repository_layout",
        planId: "klayout_trace",
        crossCheck: "lifecycle reviewer reviewer approved",
      }),
    }),
  );
  expect(calls.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      committedHead: { before: "1".repeat(40), after: "2".repeat(40) },
      proof: expect.objectContaining({
        status: "lifecycle_prefix_applied",
        commit: "2".repeat(40),
      }),
    }),
  );
});

it("applies byte-preserving moves whose exact paths far exceed the 32-root delegation limit", async () => {
  calls.moves = Array.from({ length: 20 }, (_, index) => ({
    fromPath: `area-${index}/NOTE-${index}.md`,
    toPath: `docs/operations/note-${index}.md`,
  }));
  expect(await prepareConvergenceLifecycle(context, state, () => {})).toMatchObject({
    state: "current",
  });
  const paths = calls.review.mock.calls[0]![4] as string[];
  expect(paths).toHaveLength(40);
  expect(calls.preflight).toHaveBeenCalledWith("/fixture", paths, { generated: false });
  expect(calls.apply).toHaveBeenCalledOnce();
  expect(calls.commit).toHaveBeenCalledWith(
    expect.objectContaining({
      paths,
      notice: expect.objectContaining({
        reason: "moved 20 documents to their classified routes, rewrote 0 references",
      }),
    }),
  );
});

it("parks a plan that rewrites user documents outside the delegated roots (AGENTS.md invariant 5)", async () => {
  calls.moves = Array.from({ length: 20 }, (_, index) => ({
    fromPath: `area-${index}/NOTE-${index}.md`,
    toPath: `docs/operations/note-${index}.md`,
  }));
  calls.references = Array.from({ length: 20 }, (_, index) => `service-${index}/README.md`);
  await prepareConvergenceLifecycle(context, state, () => {});
  expect(calls.review).not.toHaveBeenCalled();
  expect(calls.apply).not.toHaveBeenCalled();
  expect(calls.commit).not.toHaveBeenCalled();
  expect(calls.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      stageData: {
        parkedSources: [
          expect.objectContaining({
            stage: "lifecycle",
            path: "repository_layout",
            reason: "user_owned_content",
          }),
        ],
      },
      proof: expect.objectContaining({ status: "lifecycle_plan_parked" }),
    }),
  );
  // Inside the delegated roots, the owner's delegation is the authority for user bytes.
  vi.clearAllMocks();
  calls.normalizationRoots = ["docs", "area-0", "service-0"];
  calls.moves = [{ fromPath: "area-0/NOTE-0.md", toPath: "docs/operations/note-0.md" }];
  calls.references = ["service-0/README.md"];
  expect(await prepareConvergenceLifecycle(context, state, () => {})).toMatchObject({
    state: "current",
  });
  expect(calls.apply).toHaveBeenCalledOnce();
});

it("holds a reviewed plan as debt while a user path it touches has uncommitted work", async () => {
  calls.preflight.mockResolvedValueOnce({ reason: "paths_uncommitted", paths: ["TRACE.md"] });
  expect(await prepareConvergenceLifecycle(context, state, () => {})).toMatchObject({
    state: "attention_required",
  });
  expect(calls.apply).not.toHaveBeenCalled();
  expect(calls.commit).not.toHaveBeenCalled();
  expect(calls.waiting).toHaveBeenCalledWith(
    expect.objectContaining({
      reason: "knowledge_lifecycle_blocked",
      dependency: expect.objectContaining({
        hold: { reason: "paths_uncommitted", paths: ["TRACE.md"] },
      }),
    }),
  );
});

it("never leaves an applied plan without its commit: a failed commit fails the stage", async () => {
  calls.commit.mockResolvedValueOnce({ status: "not_committed", reason: "commit_failed" });
  await expect(prepareConvergenceLifecycle(context, state, () => {})).rejects.toMatchObject({
    code: "knowledge_apply_failed",
  });
  expect(calls.apply).toHaveBeenCalledOnce();
  expect(calls.complete).not.toHaveBeenCalled();
});

it("parks a rejected exact plan as Lervo's own debt instead of asking the owner", async () => {
  calls.review.mockRejectedValueOnce(
    Object.assign(new Error("rejected"), {
      code: "knowledge_semantic_review_rejected",
      lifecyclePlanRejection: { planHash: "sha256:" + "c".repeat(64), rationale: "loses meaning" },
    }),
  );
  await prepareConvergenceLifecycle(context, state, () => {});
  expect(calls.apply).not.toHaveBeenCalled();
  expect(calls.commit).not.toHaveBeenCalled();
  expect(calls.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      stageData: {
        parkedSources: [
          expect.objectContaining({
            stage: "lifecycle",
            path: "repository_layout",
            reason: "review_rejected",
            reasons: ["loses meaning"],
          }),
        ],
      },
      proof: expect.objectContaining({ status: "lifecycle_plan_parked" }),
    }),
  );
});

it("keeps an unreviewed generated plan inside the delegation roots", async () => {
  calls.status = "ready";
  calls.moves = [{ fromPath: ".lervo/legacy.json", toPath: "outside/legacy.json" }];
  await expect(prepareConvergenceLifecycle(context, state, () => {})).rejects.toMatchObject({
    code: "knowledge_authority_unavailable",
  });
  expect(calls.review).not.toHaveBeenCalled();
  expect(calls.apply).not.toHaveBeenCalled();
});
