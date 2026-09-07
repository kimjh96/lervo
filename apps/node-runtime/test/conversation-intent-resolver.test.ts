import { describe, expect, it } from "vitest";

import { createConversationIntentResolver } from "../src/conversation-intent-resolver.js";

const turn = {
  message: "이어서 완주해 주세요.",
  actorKind: "human" as const,
  mentioned: false,
  priorTurns: [{ role: "assistant" as const, text: "현재 작업을 확인했습니다." }],
  currentWorkstream: { title: "Conversation", objective: "Complete it", status: "active" },
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
          return { intent: "continue_work", confidence: "high" };
        },
      });
      await expect(resolver.resolve(turn)).resolves.toEqual({
        intent: "continue_work",
        confidence: "high",
        provider: {
          providerId: provider,
          model: `${provider}-model`,
          adapterVersion: "1",
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
      resolve: async () => ({ intent: "mutate_everything", confidence: "high" }),
    });
    await expect(resolver.resolve(turn)).rejects.toThrow("intent result is invalid");
  });
});
