import { createDocumentNormalizationPlan } from "@lervo/repository-knowledge";
import { beforeEach, expect, it, vi } from "vitest";

import { applyNormalizationBatch } from "../src/normalization-apply-stage.js";
import { normalizationGenerationBatchId } from "../src/normalization-generation.js";
import { NORMALIZATION_CANDIDATE_STALE_REPEATED } from "../src/normalization-stale.js";

const candidateId = "knorm_1f9ec48430c45c03b588263a";

vi.mock("@lervo/repository-knowledge", async (load) => ({
  ...(await load<typeof import("@lervo/repository-knowledge")>()),
  loadDocumentNormalizationCandidate: vi.fn(async () => ({
    candidateId: "knorm_1f9ec48430c45c03b588263a",
    items: [
      {
        operationId: "op_a",
        sourcePath: "docs/a.md",
        sourceContentHash: "sha256:a",
        approvalHash: "sha256:approval",
        outputs: [{ path: "docs/a.md" }],
      },
    ],
  })),
  createDocumentNormalizationPlan: vi.fn(),
}));
vi.mock("../src/stage-receipt.js", () => ({
  completeConvergenceStage: vi.fn(async (input: unknown) => input),
  waitingConvergenceStage: vi.fn(async (input: object) => ({ ...input, waiting: true })),
}));
vi.mock("../src/source-observation.js", () => ({
  convergenceSourceObservation: vi.fn(() => ({})),
}));
vi.mock("../src/workforce.js", () => ({
  withConvergenceAssignment: vi.fn(async (input: { run(authority: unknown): unknown }) =>
    input.run({
      agent: { agentId: "agt_writer" },
      delegation: { normalizationRoots: ["docs"] },
      assertCurrent: async () => undefined,
    }),
  ),
}));

// The flemo shape (2026-11-21): a rewind replayed the generation, so the lifecycle moved since.
async function stale(): Promise<never> {
  throw new (await import("@lervo/repository-knowledge")).RepositoryKnowledgeError(
    "knowledge_plan_stale",
    "The document normalization candidate is stale: the workset does not match the current normalization lifecycle",
  );
}

beforeEach(() => {
  vi.mocked(createDocumentNormalizationPlan).mockReset().mockImplementation(stale);
});

const context = {
  storage: { paths: { repositoryRoot: "/repository" }, artifacts: {} },
  assertSourceExact: () => undefined,
};

type Settled = {
  nextStage?: string;
  stageData?: Record<string, unknown>;
  proof?: unknown;
  waiting?: true;
  kind?: string;
  reason?: string;
  dependency?: Record<string, unknown>;
};

async function apply(stageData: Record<string, unknown> = {}): Promise<Settled> {
  const state = {
    obligationId: "kconv_1",
    snapshotHash: "sha256:snapshot",
    stageData: {
      normalizationBatch: { batchId: "batch", candidateId: "knorm_old", paths: ["docs/a.md"] },
      normalizationAcceptedCandidateId: candidateId,
      normalizationCursor: "docs/0.md",
      normalizationReview: {
        reviewerAgentId: "agt_reviewer",
        decisions: [{ operationId: "op_a", decision: "approve", sourceContentHash: "sha256:a" }],
      },
      ...stageData,
    },
  };
  return (await applyNormalizationBatch(
    context as never,
    state as never,
    () => undefined,
  )) as unknown as Settled;
}

it("generates the batch again when the lifecycle moved since its candidate (ADR-0604)", async () => {
  const result = await apply();
  expect(result.nextStage).toBe("normalization_generation");
  // The stale candidate's name changes the generation's identity, so it is not replayed; the
  // cursor stays, so the same documents are generated again against the current lifecycle.
  expect(result.stageData).toEqual({
    normalizationReview: null,
    normalizationAcceptedCandidateId: null,
    normalizationStaleCandidateId: candidateId,
    normalizationStaleRegenerations: 1,
  });
  expect(result.proof).toEqual({ status: "candidate_stale", candidateId });
});

it("settles attention when the same candidate comes back stale (ADR-0604)", async () => {
  const result = await apply({
    normalizationStaleCandidateId: candidateId,
    normalizationStaleRegenerations: 1,
  });
  // A cached generation and review make each loop free, so the second stale never regenerates.
  expect(result).toMatchObject({
    waiting: true,
    kind: "attention_required",
    reason: NORMALIZATION_CANDIDATE_STALE_REPEATED,
    dependency: { kind: "normalization_candidate_stale", candidateId, regenerations: 1 },
  });
  expect(result.nextStage).toBeUndefined();
});

it("bounds a chain of distinct stale candidates (ADR-0604)", async () => {
  const result = await apply({
    normalizationStaleCandidateId: "knorm_other",
    normalizationStaleRegenerations: 2,
  });
  expect(result).toMatchObject({
    waiting: true,
    kind: "attention_required",
    reason: NORMALIZATION_CANDIDATE_STALE_REPEATED,
  });
  const second = await apply({
    normalizationStaleCandidateId: "knorm_other",
    normalizationStaleRegenerations: 1,
  });
  expect(second.stageData).toMatchObject({
    normalizationStaleCandidateId: candidateId,
    normalizationStaleRegenerations: 2,
  });
});

it("routes a stale exact plan check before apply to the same stale path (ADR-0604)", async () => {
  vi.mocked(createDocumentNormalizationPlan)
    .mockReset()
    .mockResolvedValueOnce({ operations: [] } as never)
    .mockImplementationOnce(stale);
  const result = await apply();
  expect(vi.mocked(createDocumentNormalizationPlan)).toHaveBeenCalledTimes(2);
  expect(result.nextStage).toBe("normalization_generation");
  expect(result.proof).toEqual({ status: "candidate_stale", candidateId });
});

it("ends the stale chain when the batch settles another way (ADR-0604)", async () => {
  const result = await apply({
    normalizationAcceptedCandidateId: null,
    normalizationStaleCandidateId: candidateId,
    normalizationStaleRegenerations: 1,
  });
  expect(result.proof).toEqual({ status: "no_approved_effect" });
  expect(result.stageData).toMatchObject({
    normalizationStaleCandidateId: null,
    normalizationStaleRegenerations: 0,
  });
});

it("gives a stale regeneration its own call budget (ADR-0604)", () => {
  const state = (stageData: Record<string, unknown>) =>
    ({ obligationId: "kconv_1", snapshotHash: "sha256:snapshot", stageData }) as never;
  const first = normalizationGenerationBatchId(state({}), ["docs/a.md"], []);
  expect(normalizationGenerationBatchId(state({ other: true }), ["docs/a.md"], [])).toBe(first);
  expect(
    normalizationGenerationBatchId(
      state({ normalizationStaleCandidateId: candidateId }),
      ["docs/a.md"],
      [],
    ),
  ).not.toBe(first);
});
