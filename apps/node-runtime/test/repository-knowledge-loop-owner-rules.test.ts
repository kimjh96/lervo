import { expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  inputs: [] as Array<{ applyOwnerStatedInstructions?: () => Promise<unknown> }>,
  applied: [] as Array<{ repositoryRoot: string }>,
}));

vi.mock("@lervo/repository-knowledge-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lervo/repository-knowledge-runtime")>()),
  startAutonomousKnowledgeWorker: (input: {
    applyOwnerStatedInstructions?: () => Promise<unknown>;
  }) => {
    captured.inputs.push(input);
    return async () => undefined;
  },
  applyStoredInstructionCandidates: async (input: { repositoryRoot: string }) => {
    captured.applied.push(input);
    return { applied: 0, deferred: 0 };
  },
}));

vi.mock("../src/knowledge-convergence-ownership.js", () => ({
  createKnowledgeConvergenceOwnership: () => ({}),
  createKnowledgeConvergenceContinuity: () => ({}),
  createKnowledgePublisher: () => async () => undefined,
  instructionCandidateTransport: () => null,
  knowledgeHubChangeTransport: undefined,
}));

const { startRepositoryKnowledgeLoop } = await import("../src/repository-knowledge-loop.js");

// ADR-0594: the WSL owner ran this Node worker without the owner-rule step, so stored owner rules
// waited 7 and 18 days on every host. It now applies them as the CLI host does.
it("applies stored owner rules from the Node resident worker", async () => {
  const stop = startRepositoryKnowledgeLoop({
    repositoryRoot: "/repository",
    store: {} as never,
    artifacts: {} as never,
    provider: "codex",
    storage: { writableEventSchemaVersion: 4 } as never,
    onFailure: () => undefined,
  });
  await stop();
  expect(captured.inputs).toHaveLength(1);
  await captured.inputs[0]!.applyOwnerStatedInstructions?.();
  expect(captured.applied).toEqual([expect.objectContaining({ repositoryRoot: "/repository" })]);
});
