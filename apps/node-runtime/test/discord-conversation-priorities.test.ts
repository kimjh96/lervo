import { describe, expect, it } from "vitest";

import type { NodeDiscordConversationConfig } from "../src/config-types.js";
import {
  discordUnaddressedPriorityKey,
  resolveDiscordUnaddressedPriorities,
} from "../src/discord-conversation-priorities.js";

function config(
  participantId: string,
  priority: number,
  peers: NodeDiscordConversationConfig["peerAgents"] = [],
): NodeDiscordConversationConfig {
  return {
    integrationId: `itg_${participantId}`,
    applicationId: "999999999999999991",
    botTokenFile: "/tmp/token",
    intents: 37_377,
    allowedGuildIds: ["123456789012345678"],
    allowDirectMessages: false,
    workerId: `worker-${participantId}`,
    agentParticipantId: participantId,
    conversations: [
      {
        tenantKey: "123456789012345678",
        conversationKey: "223456789012345678",
        conversationId: "cnv_priority01",
      },
    ],
    participants: [],
    command: {
      roleId: "developer",
      provider: "codex",
      risk: "medium",
      verificationSuiteIds: ["repository.default"],
      lifetimeMs: 60_000,
      assignmentId: null,
      agentId: null,
    },
    policy: { unaddressedPriority: priority },
    peerAgents: peers,
  };
}

const peer = (participantId: string, priority: number) => ({
  participantKeys: ["webhook:899999999999999992"],
  participantId,
  roleId: "product-owner",
  displayName: "Ruen",
  unaddressedPriority: priority,
  agentBinding: {
    agentId: `agt_${"a".repeat(24)}`,
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"b".repeat(64)}`,
    roleProfileHash: `sha256:${"c".repeat(64)}`,
  },
  tenantKeys: ["123456789012345678"],
  conversationIds: ["cnv_priority01"],
});

describe("Discord unaddressed participant priorities", () => {
  it("builds one shared priority view from local and cross-node bindings", () => {
    const priorities = resolveDiscordUnaddressedPriorities([
      config("ptc_localagent01", 20, [peer("ptc_remoteagent01", 100)]),
    ]);
    expect([...priorities]).toEqual([
      [discordUnaddressedPriorityKey("ptc_localagent01", "cnv_priority01"), 20],
      [discordUnaddressedPriorityKey("ptc_remoteagent01", "cnv_priority01"), 100],
    ]);
  });

  it("rejects a participant whose local and peer views disagree", () => {
    expect(() =>
      resolveDiscordUnaddressedPriorities([
        config("ptc_remoteagent01", 40),
        config("ptc_localagent01", 20, [peer("ptc_remoteagent01", 100)]),
      ]),
    ).toThrowError("priorities differ");
  });

  it("supports reviewed priority differences between shared conversations", () => {
    const source = config("ptc_localagent01", 20, [peer("ptc_remoteagent01", 100)]);
    source.conversations.push({
      tenantKey: "123456789012345678",
      conversationKey: "323456789012345678",
      conversationId: "cnv_project02",
    });
    source.policy!.unaddressedPriorities = { cnv_project02: 100 };
    source.peerAgents![0]!.conversationIds.push("cnv_project02");
    source.peerAgents![0]!.unaddressedPriorities = { cnv_project02: 0 };

    const priorities = resolveDiscordUnaddressedPriorities([source]);
    expect(priorities.get(discordUnaddressedPriorityKey("ptc_localagent01", "cnv_project02"))).toBe(
      100,
    );
    expect(
      priorities.get(discordUnaddressedPriorityKey("ptc_remoteagent01", "cnv_project02")),
    ).toBe(0);
  });
});
