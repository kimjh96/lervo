import { describe, expect, it } from "vitest";

import { createConversationIntentResolver } from "../src/conversation-intent-resolver.js";

const turn = {
  message: "이어서 완주해 주세요.",
  actorKind: "human" as const,
  mentioned: false,
  respondingAgent: { agentId: `agt_${"a".repeat(24)}`, roleId: "developer" },
  priorTurns: [
    {
      role: "assistant" as const,
      text: "현재 작업을 확인했습니다.",
      speaker: {
        kind: "agent" as const,
        participantId: "ptc_lervoagent01",
        agentId: `agt_${"a".repeat(24)}`,
        roleId: "developer",
      },
    },
  ],
  currentWorkstream: { title: "Conversation", objective: "Complete it", status: "active" },
  availableEffects: ["none", "repository_work"] as const,
};

describe("conversation intent provider contract", () => {
  for (const provider of ["codex", "claude", "future-provider"]) {
    it(`keeps ${provider} behind the same strict semantic port`, async () => {
      let request: unknown;
      const resolver = createConversationIntentResolver({
        providerId: provider,
        model: `${provider}-model`,
        resolve: async (value) => {
          request = value;
          return {
            intent: "continue_work",
            confidence: "high",
            participation: "relevant",
            effect: { kind: "repository_work", nickname: null },
          };
        },
      });
      await expect(resolver.resolve(turn)).resolves.toEqual({
        intent: "continue_work",
        confidence: "high",
        participation: "relevant",
        effect: { kind: "repository_work" },
        provider: {
          providerId: provider,
          model: `${provider}-model`,
          adapterVersion: "2",
        },
        resultDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      });
      expect(request).toMatchObject({ untrustedConversationTurn: turn });
    });
  }

  it("rejects unsupported provider output before routing", async () => {
    const resolver = createConversationIntentResolver({
      providerId: "codex",
      model: null,
      resolve: async () => ({
        intent: "mutate_everything",
        confidence: "high",
        participation: "relevant",
        effect: { kind: "none", nickname: null },
      }),
    });
    await expect(resolver.resolve(turn)).rejects.toThrow("intent result is invalid");
  });
});
