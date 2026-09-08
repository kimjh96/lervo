import { describe, expect, it } from "vitest";

import { parseNodeRuntimeConfig } from "../src/config.js";
import { createDiscordPlatformBindings } from "../src/discord-conversation-composition.js";
import { nodeRuntimeFixture, temporaryRoot } from "./fixture.js";

const guildId = "123456789012345678";
const channelId = "223456789012345678";
const humanId = "323456789012345678";

function deployment(input: {
  suffix: string;
  applicationId: string;
  agentId: string;
  participantId: string;
  provider: "codex" | "claude";
}) {
  return {
    integrationId: `itg_discord${input.suffix}`,
    applicationId: input.applicationId,
    botTokenFile: `discord-${input.suffix}.token`,
    intents: 37_377,
    allowedGuildIds: [guildId],
    allowDirectMessages: false,
    workerId: `discord-${input.suffix}`,
    agentParticipantId: input.participantId,
    agentId: input.agentId,
    conversations: [
      { tenantKey: guildId, conversationKey: channelId, conversationId: "cnv_operator01" },
    ],
    participants: [{ tenantKey: guildId, userId: humanId, participantId: "ptc_operator01" }],
    routing: {
      readOnlyRoleId: "conversation-reader",
      intent: { provider: "claude" as const, model: "claude-haiku-4-5" },
      response: {
        provider: input.provider,
        model: input.provider === "codex" ? "gpt-5.6-sol" : "claude-sonnet-4-6",
      },
    },
    policy: { respondTo: ["human", "agent"] as const },
    command: {
      roleId: "developer",
      provider: input.provider,
      risk: "medium" as const,
      verificationSuiteIds: ["repo.check"],
      lifetimeMs: 120_000,
    },
  };
}

describe("Discord conversation deployments configuration", () => {
  it("parses distinct hired-agent bot identities with independent provider models", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, 30_001);
    const first = deployment({
      suffix: "01",
      applicationId: "999999999999999991",
      agentId: `agt_${"a".repeat(24)}`,
      participantId: "ptc_lervoagent01",
      provider: "codex",
    });
    const second = deployment({
      suffix: "02",
      applicationId: "999999999999999992",
      agentId: `agt_${"b".repeat(24)}`,
      participantId: "ptc_lervoagent02",
      provider: "claude",
    });
    const parsed = parseNodeRuntimeConfig(
      { ...fixture.value, discordConversations: [first, second] },
      root,
    );
    expect(parsed.discordConversations).toMatchObject([
      {
        applicationId: first.applicationId,
        botTokenFile: `${root}/discord-01.token`,
        agentId: first.agentId,
        routing: { response: { provider: "codex", model: "gpt-5.6-sol" } },
      },
      {
        applicationId: second.applicationId,
        botTokenFile: `${root}/discord-02.token`,
        agentId: second.agentId,
        routing: { response: { provider: "claude", model: "claude-sonnet-4-6" } },
      },
    ]);
  });

  it("fails closed on ambiguous or conflicting multi-bot identity", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, 30_002);
    const first = deployment({
      suffix: "01",
      applicationId: "999999999999999991",
      agentId: `agt_${"a".repeat(24)}`,
      participantId: "ptc_lervoagent01",
      provider: "codex",
    });
    const second = deployment({
      suffix: "02",
      applicationId: "999999999999999992",
      agentId: `agt_${"b".repeat(24)}`,
      participantId: "ptc_lervoagent02",
      provider: "claude",
    });
    expect(() =>
      parseNodeRuntimeConfig(
        { ...fixture.value, discordConversation: first, discordConversations: [second] },
        root,
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_config" }));

    const duplicateApplication = structuredClone(second);
    duplicateApplication.applicationId = first.applicationId;
    expect(() =>
      parseNodeRuntimeConfig(
        { ...fixture.value, discordConversations: [first, duplicateApplication] },
        root,
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_config" }));

    const unbound = structuredClone(second) as Record<string, unknown>;
    delete unbound.agentId;
    expect(() =>
      parseNodeRuntimeConfig({ ...fixture.value, discordConversations: [first, unbound] }, root),
    ).toThrow(expect.objectContaining({ code: "invalid_config" }));

    const conflictingChannel = structuredClone(second);
    conflictingChannel.conversations[0]!.conversationId = "cnv_otherchannel";
    expect(() =>
      parseNodeRuntimeConfig(
        { ...fixture.value, discordConversations: [first, conflictingChannel] },
        root,
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_config" }));
  });

  it("maps peer bot authors and mention aliases to the same hired-agent participant", () => {
    const config = deployment({
      suffix: "01",
      applicationId: "999999999999999991",
      agentId: `agt_${"a".repeat(24)}`,
      participantId: "ptc_lervoagent01",
      provider: "codex",
    });
    const bindings = createDiscordPlatformBindings({
      config: {
        ...config,
        participants: config.participants.map((participant) => ({
          ...participant,
          actorKind: "human" as const,
          roleId: null,
        })),
        policy: { respondTo: ["human", "agent"] },
        command: { ...config.command, assignmentId: null, agentId: null },
      },
      projectId: "prj_discord01",
      agentRoleId: "developer",
      peerAgents: [
        {
          applicationId: "999999999999999992",
          participantId: "ptc_lervoagent02",
          roleId: "researcher",
          tenantKeys: [guildId],
        },
      ],
    });
    expect(bindings.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantKey: "bot:999999999999999992",
          actor: {
            kind: "agent",
            participantId: "ptc_lervoagent02",
            roleId: "researcher",
          },
        }),
        expect.objectContaining({
          participantKey: "user:999999999999999992",
          actor: {
            kind: "agent",
            participantId: "ptc_lervoagent02",
            roleId: "researcher",
          },
        }),
      ]),
    );
  });
});
