import { describe, expect, it } from "vitest";

import { createConversationIntentResolver } from "../src/conversation-intent-resolver.js";

const turn = {
  message: "이어서 완주해 주세요.",
  actorKind: "human" as const,
  mentioned: false,
  respondingAgent: {
    participantId: "ptc_lervoagent",
    agentId: `agt_${"a".repeat(24)}`,
    roleId: "developer",
  },
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
            executionProfile: "reasoning",
          };
        },
      });
      await expect(resolver.resolve(turn)).resolves.toEqual({
        intent: "continue_work",
        confidence: "high",
        participation: "relevant",
        effect: { kind: "repository_work" },
        executionProfile: "reasoning",
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
        executionProfile: null,
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
          executionProfile: null,
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
        executionProfile: null,
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

  it("routes a bounded task to the active hired agent", async () => {
    const task = "대화 포커스 회귀 테스트를 실행하고 결과를 보고하세요.";
    let request: unknown;
    const resolver = createConversationIntentResolver({
      providerId: "codex",
      model: null,
      resolve: async (value) => {
        request = value;
        return {
          intent: "continue_work",
          confidence: "high",
          participation: "relevant",
          effect: {
            kind: "workforce_task_delegate",
            nickname: null,
            name: null,
            specification: JSON.stringify({ participantId: "ptc_peer_researcher0001", task }),
          },
          executionProfile: null,
        };
      },
    });

    await expect(
      resolver.resolve({
        ...turn,
        availableEffects: ["none", "repository_work", "workforce_task_delegate"],
      }),
    ).resolves.toMatchObject({
      effect: {
        kind: "workforce_task_delegate",
        specification: JSON.stringify({ participantId: "ptc_peer_researcher0001", task }),
      },
    });
    expect(JSON.stringify(request)).toContain(
      "a compact JSON object with exactly participantId and task",
    );
  });

  it("routes an explicit natural-language debate through the governed deliberation effect", async () => {
    const topic = "저장소 지식 충돌 전략을 독립적으로 검토하고 결론을 내려 주세요.";
    const resolver = createConversationIntentResolver({
      providerId: "codex",
      model: null,
      resolve: async () => ({
        intent: "continue_work",
        confidence: "high",
        participation: "relevant",
        effect: {
          kind: "deliberation_start",
          nickname: null,
          name: null,
          specification: topic,
        },
        executionProfile: null,
      }),
    });
    await expect(
      resolver.resolve({
        ...turn,
        availableEffects: ["none", "repository_work", "deliberation_start"],
      }),
    ).resolves.toMatchObject({ effect: { kind: "deliberation_start", specification: topic } });
  });
});
