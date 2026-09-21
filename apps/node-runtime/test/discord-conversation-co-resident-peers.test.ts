import type { ConversationAgentBinding } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import type { NodeDiscordConversationConfig } from "../src/config-types.js";
import { createDiscordPlatformBindings } from "../src/discord-conversation-composition.js";
import { createCoResidentDiscordPeerAgents } from "../src/discord-conversation-co-resident-peers.js";

const guildId = "123456789012345678";
const channelId = "223456789012345678";

function deployment(input: {
  applicationId: string;
  participantId: string;
  agentId: string;
  participants?: NodeDiscordConversationConfig["participants"];
  peerAgents?: NodeDiscordConversationConfig["peerAgents"];
}): NodeDiscordConversationConfig {
  return {
    integrationId: `itg_${input.applicationId}`,
    applicationId: input.applicationId,
    botTokenFile: "/tmp/discord.token",
    intents: 37_377,
    allowedGuildIds: [guildId],
    allowDirectMessages: false,
    workerId: `worker-${input.applicationId}`,
    agentParticipantId: input.participantId,
    agentId: input.agentId,
    speaker: { kind: "bot" },
    conversations: [
      { tenantKey: guildId, conversationKey: channelId, conversationId: "cnv_shared001" },
    ],
    participants: input.participants ?? [],
    ...(input.peerAgents === undefined ? {} : { peerAgents: input.peerAgents }),
    command: {
      roleId: "developer",
      provider: "codex",
      risk: "medium",
      verificationSuiteIds: ["repository.default.v4"],
      lifetimeMs: 300_000,
      assignmentId: null,
      agentId: null,
    },
  };
}

function binding(agentId: string): ConversationAgentBinding {
  return {
    agentId,
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"a".repeat(64)}`,
    roleProfileHash: `sha256:${"b".repeat(64)}`,
  };
}

describe("co-resident Discord peer agents", () => {
  it("lets an explicit manual chain starter override only its automatic peer binding", () => {
    const first = deployment({
      applicationId: "999999999999999991",
      participantId: "ptc_firstagent01",
      agentId: `agt_${"1".repeat(24)}`,
      participants: [
        {
          tenantKey: guildId,
          userId: "999999999999999992",
          participantId: "ptc_secondagent1",
          actorKind: "agent",
          roleId: "ceo",
          startsAutomationChain: true,
        },
      ],
    });
    const second = deployment({
      applicationId: "999999999999999992",
      participantId: "ptc_secondagent1",
      agentId: `agt_${"2".repeat(24)}`,
    });
    const configs = [first, second];
    const participations = [
      {
        agentId: first.agentId!,
        displayName: "First",
        roleId: "product-owner",
        agentBinding: binding(first.agentId!),
      },
      {
        agentId: second.agentId!,
        displayName: "Second",
        roleId: "ceo",
        agentBinding: binding(second.agentId!),
      },
    ];

    const firstPeers = createCoResidentDiscordPeerAgents({
      configs,
      participations,
      currentIndex: 0,
    });
    expect(firstPeers).toMatchObject([
      {
        participantKeys: ["bot:999999999999999992", "user:999999999999999992"],
        participantId: "ptc_secondagent1",
        tenantKeys: [guildId],
        conversationIds: ["cnv_shared001"],
      },
    ]);
    const bindings = createDiscordPlatformBindings({
      config: first,
      projectId: "prj_12345678",
      agentRoleId: "product-owner",
      peerAgents: firstPeers,
    });
    expect(
      bindings.participants.filter(
        (participant) => participant.participantKey === "bot:999999999999999992",
      ),
    ).toEqual([
      expect.objectContaining({
        startsAutomationChain: true,
        actor: expect.objectContaining({
          participantId: "ptc_secondagent1",
          agentBinding: binding(second.agentId!),
        }),
      }),
    ]);
    expect(
      createCoResidentDiscordPeerAgents({ configs, participations, currentIndex: 1 }),
    ).toMatchObject([
      {
        participantKeys: ["bot:999999999999999991", "user:999999999999999991"],
        participantId: "ptc_firstagent01",
        tenantKeys: [guildId],
        conversationIds: ["cnv_shared001"],
      },
    ]);
  });

  it("does not let every automatic peer start an unaddressed automation chain", () => {
    const first = deployment({
      applicationId: "999999999999999991",
      participantId: "ptc_firstagent01",
      agentId: `agt_${"1".repeat(24)}`,
    });
    const second = deployment({
      applicationId: "999999999999999992",
      participantId: "ptc_secondagent1",
      agentId: `agt_${"2".repeat(24)}`,
    });
    const peerAgents = createCoResidentDiscordPeerAgents({
      configs: [first, second],
      participations: [
        {
          agentId: first.agentId!,
          displayName: "First",
          roleId: "product-owner",
          agentBinding: binding(first.agentId!),
        },
        {
          agentId: second.agentId!,
          displayName: "Second",
          roleId: "ceo",
          agentBinding: binding(second.agentId!),
        },
      ],
      currentIndex: 0,
    });
    const bindings = createDiscordPlatformBindings({
      config: first,
      projectId: "prj_12345678",
      agentRoleId: "product-owner",
      peerAgents,
    });
    const automaticPeer = bindings.participants.find(
      (participant) => participant.participantKey === "bot:999999999999999992",
    );

    expect(automaticPeer).toBeDefined();
    expect(automaticPeer).not.toHaveProperty("startsAutomationChain");
  });

  it("rejects a manual override whose role differs from the hired peer", () => {
    const first = deployment({
      applicationId: "999999999999999991",
      participantId: "ptc_firstagent01",
      agentId: `agt_${"1".repeat(24)}`,
      participants: [
        {
          tenantKey: guildId,
          userId: "999999999999999992",
          participantId: "ptc_secondagent1",
          actorKind: "agent",
          roleId: "developer",
          startsAutomationChain: true,
        },
      ],
    });
    const second = deployment({
      applicationId: "999999999999999992",
      participantId: "ptc_secondagent1",
      agentId: `agt_${"2".repeat(24)}`,
    });

    expect(() =>
      createCoResidentDiscordPeerAgents({
        configs: [first, second],
        participations: [
          {
            agentId: first.agentId!,
            displayName: "First",
            roleId: "product-owner",
            agentBinding: binding(first.agentId!),
          },
          {
            agentId: second.agentId!,
            displayName: "Second",
            roleId: "ceo",
            agentBinding: binding(second.agentId!),
          },
        ],
        currentIndex: 0,
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_config" }));
  });

  it("refreshes one configured co-resident peer from the current hired role binding", () => {
    const secondAgentId = `agt_${"2".repeat(24)}`;
    const first = deployment({
      applicationId: "999999999999999991",
      participantId: "ptc_firstagent01",
      agentId: `agt_${"1".repeat(24)}`,
      peerAgents: [
        {
          participantKeys: ["bot:999999999999999992", "user:999999999999999992"],
          participantId: "ptc_secondagent1",
          roleId: "ceo",
          agentBinding: binding(secondAgentId),
          tenantKeys: [guildId],
          conversationIds: ["cnv_shared001"],
        },
      ],
    });
    const second = deployment({
      applicationId: "999999999999999992",
      participantId: "ptc_secondagent1",
      agentId: secondAgentId,
    });
    const currentBinding = {
      ...binding(secondAgentId),
      roleContractHash: `sha256:${"c".repeat(64)}`,
      roleProfileHash: `sha256:${"d".repeat(64)}`,
    };
    const refreshed = createCoResidentDiscordPeerAgents({
      configs: [first, second],
      participations: [
        {
          agentId: first.agentId!,
          displayName: "First",
          roleId: "product-owner",
          agentBinding: binding(first.agentId!),
        },
        {
          agentId: second.agentId!,
          displayName: "Second",
          roleId: "ceo",
          agentBinding: currentBinding,
        },
      ],
      currentIndex: 0,
    });
    expect(refreshed).toEqual([
      expect.objectContaining({
        participantId: second.agentParticipantId,
        agentBinding: currentBinding,
      }),
    ]);
    const platform = createDiscordPlatformBindings({
      config: first,
      projectId: "prj_12345678",
      agentRoleId: "product-owner",
      peerAgents: refreshed,
    });
    expect(
      platform.participants.filter(
        (participant) => participant.participantKey === `bot:${second.applicationId}`,
      ),
    ).toEqual([
      expect.objectContaining({ actor: expect.objectContaining({ agentBinding: currentBinding }) }),
    ]);
  });
});
