import { expect, it, vi } from "vitest";

import { DEFAULT_MODEL_SELECTION } from "@lervo/execution-contract";

const opened = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@lervo/repository-knowledge-compiler", async (load) => ({
  ...(await load<typeof import("@lervo/repository-knowledge-compiler")>()),
  createNoCapabilityProviderJsonRunner: async (options: Record<string, unknown>) => {
    opened.push(options);
    return { resolve: async () => ({}) };
  },
}));
vi.mock("@lervo/repository-knowledge", async (load) => ({
  ...(await load<typeof import("@lervo/repository-knowledge")>()),
  durableInstructionCrossCheckRequest: () => ({}),
  parseDurableInstructionCrossCheckResponse: () => ({ verdict: "agree" }),
}));

const { crossCheckDurableInstruction } = await import("../src/durable-instruction-cross-check.js");

it("runs the fidelity check on the review route for its provider (ADR-0612)", async () => {
  await crossCheckDurableInstruction({
    provider: "claude",
    ownerText: "Use Korean for owner-facing responses.",
    instruction: {} as never,
    readSelection: async () => ({
      ...DEFAULT_MODEL_SELECTION,
      revision: 1,
      roles: { review: [{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: null }] },
    }),
  });
  expect(opened[0]).toMatchObject({
    strategy: expect.objectContaining({ provider: "claude" }),
    model: "claude-opus-5-5",
    reasoningEffort: "high",
  });
});
