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

  it("allows distinct webhook speakers to share one authenticated Gateway application", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, 30_003);
    const first = deployment({
      suffix: "01",
      applicationId: "999999999999999991",
      agentId: `agt_${"a".repeat(24)}`,
      participantId: "ptc_lervoagent01",
      provider: "codex",
    });
    const second = deployment({
      suffix: "02",
      applicationId: first.applicationId,
      agentId: `agt_${"b".repeat(24)}`,
      participantId: "ptc_lervoagent02",
      provider: "claude",
    });
    second.botTokenFile = first.botTokenFile;
    const firstWebhook = {
      kind: "webhook" as const,
      webhooks: [
        {
          channelId,
          webhookId: "899999999999999991",
          tokenFile: "discord-webhook-01.token",
        },
      ],
    };
    const secondWebhook = {
      kind: "webhook" as const,
      webhooks: [
        {
          channelId,
          webhookId: "899999999999999992",
          tokenFile: "discord-webhook-02.token",
        },
      ],
    };

    const parsed = parseNodeRuntimeConfig(
      {
        ...fixture.value,
        discordConversations: [
          {
            ...first,
            speaker: firstWebhook,
            administration: {
              allowedActions: ["incoming_webhook.create"],
              webhookCredentialDirectory: "discord-webhooks",
            },
          },
          { ...second, speaker: secondWebhook },
        ],
      },
      root,
    );

    expect(parsed.discordConversations).toMatchObject([
      {
        applicationId: first.applicationId,
        botTokenFile: `${root}/discord-01.token`,
        speaker: {
          kind: "webhook",
          webhooks: [{ webhookId: "899999999999999991" }],
        },
        administration: {
          allowedActions: ["incoming_webhook.create"],
          webhookCredentialDirectory: `${root}/discord-webhooks`,
        },
      },
      {
        applicationId: first.applicationId,
        botTokenFile: `${root}/discord-01.token`,
        speaker: {
          kind: "webhook",
          webhooks: [{ webhookId: "899999999999999992" }],
        },
      },
    ]);
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
          participantKeys: ["bot:999999999999999992", "user:999999999999999992"],
          participantId: "ptc_lervoagent02",
          roleId: "researcher",
          agentBinding: {
            agentId: `agt_${"b".repeat(24)}`,
            roleVersion: "1.0.0",
            roleContractHash: `sha256:${"c".repeat(64)}`,
            roleProfileHash: `sha256:${"d".repeat(64)}`,
          },
          tenantKeys: [guildId],
          conversationIds: ["cnv_operator01"],
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
            agentBinding: {
              agentId: `agt_${"b".repeat(24)}`,
              roleVersion: "1.0.0",
              roleContractHash: `sha256:${"c".repeat(64)}`,
              roleProfileHash: `sha256:${"d".repeat(64)}`,
            },
          },
        }),
        expect.objectContaining({
          participantKey: "user:999999999999999992",
          actor: {
            kind: "agent",
            participantId: "ptc_lervoagent02",
            roleId: "researcher",
            agentBinding: {
              agentId: `agt_${"b".repeat(24)}`,
              roleVersion: "1.0.0",
              roleContractHash: `sha256:${"c".repeat(64)}`,
              roleProfileHash: `sha256:${"d".repeat(64)}`,
            },
          },
        }),
      ]),
    );
  });

  it("preserves an explicit automation-chain starter on a manual agent binding", () => {
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
        participants: [
          {
            tenantKey: guildId,
            userId: "799999999999999991",
            participantId: "ptc_ceoagent01",
            actorKind: "agent",
            roleId: "ceo",
            startsAutomationChain: true,
          },
        ],
        policy: { respondTo: ["human", "agent"] },
        command: { ...config.command, assignmentId: null, agentId: null },
      },
      projectId: "prj_discord01",
      agentRoleId: "developer",
    });
    expect(bindings.participants).toContainEqual(
      expect.objectContaining({
        participantKey: "bot:799999999999999991",
        startsAutomationChain: true,
      }),
    );
  });

  it("maps a peer webhook author to its durable hired-agent participant", () => {
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
          participantKeys: ["webhook:899999999999999992"],
          participantId: "ptc_lervoagent02",
          roleId: "researcher",
          agentBinding: {
            agentId: `agt_${"b".repeat(24)}`,
            roleVersion: "1.0.0",
            roleContractHash: `sha256:${"c".repeat(64)}`,
            roleProfileHash: `sha256:${"d".repeat(64)}`,
          },
          tenantKeys: [guildId],
          conversationIds: ["cnv_operator01"],
        },
      ],
    });

    expect(bindings.participants).toContainEqual(
      expect.objectContaining({
        participantKey: "webhook:899999999999999992",
        actor: expect.objectContaining({
          participantId: "ptc_lervoagent02",
          agentBinding: expect.objectContaining({ agentId: `agt_${"b".repeat(24)}` }),
        }),
      }),
    );
  });
});
