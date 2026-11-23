import { expect, it, vi } from "vitest";

import { DEFAULT_MODEL_SELECTION, type ModelSelection } from "@lervo/execution-contract";

const opened = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@lervo/repository-knowledge-compiler", async (load) => ({
  ...(await load<typeof import("@lervo/repository-knowledge-compiler")>()),
  createNoCapabilityProviderJsonRunner: async (options: Record<string, unknown>) => {
    opened.push(options);
    return {
      resolve: async () => ({
        intent: "answer",
        confidence: "high",
        participation: "relevant",
        effect: { kind: "none", nickname: null, name: null, specification: null },
        executionProfile: null,
      }),
    };
  },
}));

const { createProviderConversationIntentResolver } =
  await import("../src/conversation-intent-provider.js");

const turn = {
  message: "What changed?",
  actorKind: "human" as const,
  mentioned: true,
  respondingAgent: {
    participantId: "ptc_agent",
    agentId: `agt_${"a".repeat(24)}`,
    roleId: "developer",
  },
  priorTurns: [],
  currentWorkstream: null,
  availableEffects: ["none"] as const,
};

it("resolves each turn on the routine route current at that turn (ADR-0612)", async () => {
  let roles: ModelSelection["roles"] = {};
  const resolver = await createProviderConversationIntentResolver({
    provider: "codex",
    model: "configured-model",
    executables: { claude: "/opt/claude" },
    readModelSelection: () => ({ ...DEFAULT_MODEL_SELECTION, revision: 1, roles }),
    startable: () => true,
  });
  await expect(resolver.resolve(turn)).resolves.toMatchObject({
    provider: { providerId: "codex", model: "configured-model" },
  });
  roles = { routine: [{ provider: "claude", model: "claude-haiku-5-5", reasoningEffort: "low" }] };
  await expect(resolver.resolve(turn)).resolves.toMatchObject({
    provider: { providerId: "claude", model: "claude-haiku-5-5" },
  });
  await resolver.resolve(turn);
  // The configured runner opens at startup; the routed one once, then it is reused.
  expect(opened).toEqual([
    expect.objectContaining({ provider: "codex", model: "configured-model" }),
    expect.objectContaining({
      provider: "claude",
      executable: "/opt/claude",
      model: "claude-haiku-5-5",
      reasoningEffort: "low",
    }),
  ]);
});

it("starts a Node whose configured intent provider the routine role removed", async () => {
  opened.length = 0;
  const resolver = await createProviderConversationIntentResolver({
    provider: "codex",
    model: "configured-model",
    readModelSelection: () => ({
      ...DEFAULT_MODEL_SELECTION,
      revision: 1,
      roles: { routine: [{ provider: "claude", model: null, reasoningEffort: null }] },
    }),
    startable: (provider) => provider === "claude",
  });
  // Only the route the role chooses opens; the removed provider is never started.
  expect(opened).toEqual([expect.objectContaining({ provider: "claude" })]);
  await expect(resolver.resolve(turn)).resolves.toMatchObject({
    provider: { providerId: "claude", model: null },
  });
});
