import { describe, expect, it } from "vitest";

import type { NodeDiscordConversationConfig } from "../src/config-types.js";
import { conversationResultEvaluationSelection } from "../src/conversation-result-evaluation.js";

function config(
  routing: NonNullable<NodeDiscordConversationConfig["routing"]>,
): NodeDiscordConversationConfig {
  return {
    integrationId: "itg_discord01",
    applicationId: "999999999999999999",
    botTokenFile: "/tmp/discord.token",
    intents: 37_377,
    allowedGuildIds: ["123456789012345678"],
    allowDirectMessages: false,
    workerId: "discord-worker",
    agentParticipantId: "ptc_agent01",
    conversations: [
      {
        tenantKey: "123456789012345678",
        conversationKey: "223456789012345678",
        conversationId: "cnv_operator01",
      },
    ],
    participants: [],
    routing,
    command: {
      roleId: "developer",
      provider: "codex",
      risk: "medium",
      verificationSuiteIds: ["repo.check"],
      lifetimeMs: 120_000,
      assignmentId: null,
      agentId: null,
    },
  };
}

describe("conversation result evaluation selection", () => {
  it("uses the explicit result evaluator independently from read-response evaluation", () => {
    expect(
      conversationResultEvaluationSelection(
        config({
          readOnlyRoleId: "conversation-reader",
          response: { provider: "codex" },
          evaluation: { provider: "codex", model: "gpt-6-astra" },
          resultEvaluation: {
            provider: "claude",
            model: "claude-opus-5",
            reasoningEffort: "high",
          },
        }),
      ),
    ).toEqual({ provider: "claude", model: "claude-opus-5", reasoningEffort: "high" });
  });

  it("keeps existing deployments compatible by falling back to read-response evaluation", () => {
    expect(
      conversationResultEvaluationSelection(
        config({
          readOnlyRoleId: "conversation-reader",
          response: { provider: "codex" },
          evaluation: { provider: "claude", model: "claude-sonnet-4-6" },
        }),
      ),
    ).toEqual({ provider: "claude", model: "claude-sonnet-4-6" });
  });

  it("falls back to the command provider without inventing model configuration", () => {
    expect(
      conversationResultEvaluationSelection(
        config({ readOnlyRoleId: "conversation-reader", response: { provider: "codex" } }),
      ),
    ).toEqual({ provider: "codex" });
  });
});
