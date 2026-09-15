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
            effect: {
              kind: "repository_work",
              nickname: null,
              name: null,
              specification: null,
            },
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
          adapterVersion: "3",
        },
        resultDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      });
      expect(request).toMatchObject({ untrustedConversationTurn: turn });
      expect(JSON.stringify(request)).toContain(
        "Read-only live work is still continue_work even when it is expected to leave repository bytes unchanged.",
      );
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
        effect: { kind: "none", nickname: null, name: null, specification: null },
      }),
    });
    await expect(resolver.resolve(turn)).rejects.toThrow("intent result is invalid");
  });

  it("routes bounded Discord channel and thread creation effects", async () => {
    for (const [kind, name] of [
      ["discord_guild_text_channel_create", "release-room"],
      ["discord_public_thread_create", "Release review"],
    ] as const) {
      const resolver = createConversationIntentResolver({
        providerId: "codex",
        model: null,
        resolve: async () => ({
          intent: "continue_work",
          confidence: "high",
          participation: "relevant",
          effect: { kind, nickname: null, name, specification: null },
        }),
      });
      await expect(
        resolver.resolve({ ...turn, availableEffects: ["none", "repository_work", kind] }),
      ).resolves.toMatchObject({ effect: { kind, name } });
    }
  });

  it("admits a semantic supervision goal only when that owner effect is available", async () => {
    const resolver = createConversationIntentResolver({
      providerId: "codex",
      model: null,
      resolve: async () => ({
        intent: "continue_work",
        confidence: "high",
        participation: "relevant",
        effect: {
          kind: "supervision_goal_request",
          nickname: null,
          name: null,
          specification: null,
        },
      }),
    });
    await expect(
      resolver.resolve({
        ...turn,
        availableEffects: ["none", "repository_work", "supervision_goal_request"],
      }),
    ).resolves.toMatchObject({ effect: { kind: "supervision_goal_request" } });
    await expect(resolver.resolve(turn)).resolves.toMatchObject({
      intent: "clarify",
      effect: { kind: "none" },
    });
  });
});
