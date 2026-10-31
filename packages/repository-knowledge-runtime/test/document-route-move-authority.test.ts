import { afterEach, expect, it, vi } from "vitest";
import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { prepareConvergenceLifecycle } from "../src/lifecycle-prefix.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";

const calls = vi.hoisted(() => ({
  apply: vi.fn(async () => ({ movedCount: 1 })),
  normalizationRoots: ["docs"],
  canonicalRoots: ["docs"],
  references: [] as string[],
  review: vi.fn(async () => ({ reviewerAgentId: "reviewer" })),
  observe: vi.fn(async (_input: unknown) => {}),
}));
vi.mock("@lervo/repository-knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lervo/repository-knowledge")>()),
  createKnowledgeInstructionBootstrapPlan: async () => ({ status: "not_applicable" }),
  createRepositoryLayoutMigrationPlan: async () => ({
    planKind: "repository_layout",
    planId: "klayout_trace",
    status: "review_required",
    deferredDocuments: [],
    deferredDocumentCount: 0,
    semanticClassificationIds: [],
    moves: [
      {
        fromPath: "TRACE.md",
        toPath: "docs/operations/TRACE.md",
        operationId: "trace",
        approvalHash: "sha256:" + "a".repeat(64),
      },
    ],
    userUpdates: [],
    operations: [
      {
        path: "TRACE.md",
        destinationPath: "docs/operations/TRACE.md",
        action: "move",
        expectedCurrentHash: "sha256:" + "a".repeat(64),
      },
      ...calls.references.map((path) => ({
        path,
        action: "update",
        expectedCurrentHash: "sha256:" + "a".repeat(64),
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
  inspectDocumentRouteResolutionContext: async () => ({
    providerAvailable: true,
    normalizationRoots: ["docs"],
  }),
}));
vi.mock("../src/delegation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/delegation.js")>()),
  assertConvergenceDelegation: async () => ({
    canonicalRoots: calls.canonicalRoots,
    normalizationRoots: calls.normalizationRoots,
  }),
}));
vi.mock("../src/document-deferral-health.js", () => ({ observeDocumentDeferrals: calls.observe }));
vi.mock("../src/lifecycle-plan-review.js", () => ({
  reviewLifecyclePlan: calls.review,
}));
vi.mock("../src/workforce.js", () => ({
  withConvergenceAssignment: async (input: { run(authority: unknown): Promise<unknown> }) =>
    input.run({
      agent: { agentId: "writer" },
      delegation: {
        canonicalRoots: calls.canonicalRoots,
        normalizationRoots: calls.normalizationRoots,
      },
      assertCurrent: async () => {},
    }),
}));
vi.mock("../src/source-capture.js", () => ({ captureConvergenceSources: () => ({ sources: [] }) }));
vi.mock("../src/stage-receipt.js", () => ({
  completeConvergenceStage: async () => ({ state: "current" }),
}));
vi.mock("../src/convergence-parking.js", () => ({
  carriedParkedSources: async () => [],
  mergeParkedSources: () => [],
  obligationParkedSources: () => [],
}));
afterEach(() => {
  calls.apply.mockClear();
  calls.review.mockClear();
  calls.observe.mockClear();
  calls.normalizationRoots = ["docs"];
  calls.canonicalRoots = ["docs"];
  calls.references = [];
});

it("refuses an outside-root move until the owner adds exactly the source file to the delegation", async () => {
  const context = {
    storage: { paths: { repositoryRoot: "/fixture" } },
    assertSource() {},
  } as unknown as ConvergenceRuntimeContext;
  const state = {
    baseline: { policyHash: "sha256:" + "a".repeat(64) },
    stageData: {},
  } as unknown as KnowledgeConvergenceInput;
  expect(await prepareConvergenceLifecycle(context, state, () => {})).toBeNull();
  expect(calls.observe).toHaveBeenCalledWith(
    expect.objectContaining({
      layout: expect.objectContaining({
        coverage: { complete: false },
        moves: [],
        deferredDocuments: [
          expect.objectContaining({
            path: "TRACE.md",
            resolution: "delegation_scope",
            requiredPaths: ["TRACE.md"],
          }),
        ],
      }),
    }),
  );
  expect(calls.review).not.toHaveBeenCalled();
  expect(calls.apply).not.toHaveBeenCalled();
  calls.normalizationRoots = ["docs", "TRACE.md"];
  expect(await prepareConvergenceLifecycle(context, state, () => {})).toMatchObject({
    state: "current",
  });
  expect(calls.apply).toHaveBeenCalledOnce();
});

it.each(["destination", "reference"] as const)(
  "checks an unauthorized %s before any full-body review",
  async (kind) => {
    calls.normalizationRoots = ["TRACE.md"];
    calls.canonicalRoots = kind === "destination" ? [] : ["docs"];
    calls.references = kind === "reference" ? ["OTHER.md"] : [];
    const context = {
      storage: { paths: { repositoryRoot: "/fixture" } },
    } as unknown as ConvergenceRuntimeContext;
    const state = { baseline: {}, stageData: {} } as unknown as KnowledgeConvergenceInput;
    expect(await prepareConvergenceLifecycle(context, state, () => {})).toBeNull();
    expect(calls.review).not.toHaveBeenCalled();
    expect(calls.apply).not.toHaveBeenCalled();
    expect(calls.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        layout: expect.objectContaining({
          deferredDocuments: [
            expect.objectContaining({
              path: "TRACE.md",
              resolution: "delegation_scope",
              requiredPaths: [kind === "destination" ? "docs/operations/TRACE.md" : "OTHER.md"],
            }),
          ],
        }),
      }),
    );
  },
);
