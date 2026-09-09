import { describe, expect, it } from "vitest";

import type { DiscordAgentParticipation } from "../src/discord-agent-participation.js";
import { createDiscordConversationParticipationPolicy } from "../src/discord-conversation-participation-policy.js";
import type { NodeDiscordConversationConfig } from "../src/config-types.js";

const participation: DiscordAgentParticipation = {
  agentId: `agt_${"a".repeat(24)}`,
  displayName: "Tarin",
  roleId: "developer",
};

function config(routing: boolean): NodeDiscordConversationConfig {
  return {
    integrationId: "itg_discord01",
    applicationId: "999999999999999999",
    botTokenFile: "/tmp/discord.token",
    intents: 37_377,
    allowedGuildIds: ["123456789012345678"],
    allowDirectMessages: false,
    workerId: "discord-operator",
    agentParticipantId: "ptc_lervoagent",
    conversations: [
      {
        tenantKey: "123456789012345678",
        conversationKey: "223456789012345678",
        conversationId: "cnv_operator01",
      },
    ],
    participants: [],
    ...(routing
      ? {
          routing: {
            readOnlyRoleId: "conversation-reader",
            response: { provider: "codex" as const },
          },
        }
      : {}),
    command: {
      roleId: "developer",
      provider: "claude",
      risk: "medium",
      verificationSuiteIds: ["repository.default.v4"],
      lifetimeMs: 300_000,
      assignmentId: null,
      agentId: null,
    },
  };
}

describe("Discord conversation participation policy", () => {
  it("uses conversational defaults only for managed natural-language routing", () => {
    expect(
      createDiscordConversationParticipationPolicy({
        config: config(true),
        projectId: "prj_project01",
        projectCreatedAt: "2026-09-09T00:00:00.000Z",
        agentParticipation: participation,
      }),
    ).toMatchObject({
      mode: "relevant",
      unaddressedHumanMessages: "respond",
      maxResponsesPerHour: 60,
    });
    expect(
      createDiscordConversationParticipationPolicy({
        config: config(false),
        projectId: "prj_project01",
        projectCreatedAt: "2026-09-09T00:00:00.000Z",
        agentParticipation: participation,
      }),
    ).toMatchObject({
      mode: "mention_only",
      unaddressedHumanMessages: "evaluate",
      maxResponsesPerHour: 8,
    });
  });

  it("preserves explicit participation bounds", () => {
    const configured = config(true);
    configured.policy = {
      unaddressedHumanMessages: "evaluate",
      maxResponsesPerHour: 12,
    };
    expect(
      createDiscordConversationParticipationPolicy({
        config: configured,
        projectId: "prj_project01",
        projectCreatedAt: "2026-09-09T00:00:00.000Z",
        agentParticipation: participation,
      }),
    ).toMatchObject({
      unaddressedHumanMessages: "evaluate",
      maxResponsesPerHour: 12,
    });
  });
});
