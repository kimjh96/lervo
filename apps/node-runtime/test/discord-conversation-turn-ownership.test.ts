import {
  createConversationInboundEvent,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { describe, expect, it } from "vitest";

import { createDiscordConversationTurnOwnership } from "../src/discord-conversation-turn-ownership.js";

const peer = {
  participantKeys: ["bot:999999999999999992", "user:999999999999999992"],
  participantId: "ptc_lervoagent02",
  roleId: "researcher",
  agentBinding: {
    agentId: `agt_${"b".repeat(24)}`,
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"c".repeat(64)}`,
    roleProfileHash: `sha256:${"d".repeat(64)}`,
  },
  tenantKeys: ["123456789012345678"],
  conversationIds: ["cnv_operator01"],
};

function event(
  integrationId: string,
  participantIds: string[] = [],
  occurredAt = "2026-09-09T00:00:00.000Z",
) {
  return createConversationInboundEvent({
    sourceEventKeyHash: hashConversationSourceEventKey("discord-message-42"),
    target: {
      integrationId,
      projectId: "prj_project01",
      conversationId: "cnv_operator01",
      threadId: null,
    },
    kind: "message.created",
    actor: { kind: "human", participantId: "ptc_operator01", roleId: null },
    content: {
      artifactId: "art_message01",
      contentHash: `sha256:${"a".repeat(64)}`,
      byteCount: 12,
      mediaType: "text/plain; charset=utf-8",
    },
    mentions: { roleIds: [], participantIds },
    replyToEventId: null,
    signalCode: null,
    automationDepth: 0,
    occurredAt,
  });
}

function policy(roleId: string) {
  return createConversationParticipationPolicy({
    projectId: "prj_project01",
    roleId,
    conversationIds: ["cnv_operator01"],
    mode: "relevant",
    respondTo: ["human", "agent"],
    signalCodes: [],
    cooldownSeconds: 0,
    maxResponsesPerHour: 8,
    maxAutomationDepth: 2,
    createdAt: "2026-09-08T00:00:00.000Z",
  });
}

describe("Discord multi-agent turn ownership", () => {
  it("selects exactly one bot for the same unaddressed Discord source message", () => {
    const first = createDiscordConversationTurnOwnership({
      participantId: "ptc_lervoagent01",
      roleId: "developer",
      conversationIds: ["cnv_operator01"],
      peers: [peer],
    });
    const second = createDiscordConversationTurnOwnership({
      participantId: peer.participantId,
      roleId: peer.roleId,
      conversationIds: ["cnv_operator01"],
      peers: [
        {
          ...peer,
          participantKeys: ["bot:999999999999999991", "user:999999999999999991"],
          participantId: "ptc_lervoagent01",
          roleId: "developer",
        },
      ],
    });

    expect(
      [
        first.owns({ event: event("itg_discord01"), policy: policy("developer") }),
        second.owns({ event: event("itg_discord02"), policy: policy("researcher") }),
      ].filter(Boolean),
    ).toHaveLength(1);
  });

  it("gives an exact participant mention to that bot only", () => {
    const first = createDiscordConversationTurnOwnership({
      participantId: "ptc_lervoagent01",
      roleId: "developer",
      conversationIds: ["cnv_operator01"],
      peers: [peer],
    });
    const second = createDiscordConversationTurnOwnership({
      participantId: peer.participantId,
      roleId: peer.roleId,
      conversationIds: ["cnv_operator01"],
      peers: [
        {
          ...peer,
          participantKeys: ["bot:999999999999999991", "user:999999999999999991"],
          participantId: "ptc_lervoagent01",
          roleId: "developer",
        },
      ],
    });
    const addressed = event("itg_discord01", [peer.participantId]);
    const { schemaVersion: _schemaVersion, eventId: _eventId, ...addressedContent } = addressed;
    const peerAddressed = createConversationInboundEvent({
      ...addressedContent,
      target: { ...addressed.target, integrationId: "itg_discord02" },
    });

    expect(first.owns({ event: addressed, policy: policy("developer") })).toBe(false);
    expect(second.owns({ event: peerAddressed, policy: policy("researcher") })).toBe(true);
  });

  it("keeps the explicitly addressed agent as owner for subsequent unaddressed human turns", () => {
    const first = createDiscordConversationTurnOwnership({
      participantId: "ptc_lervoagent01",
      roleId: "developer",
      conversationIds: ["cnv_operator01"],
      peers: [peer],
    });
    const second = createDiscordConversationTurnOwnership({
      participantId: peer.participantId,
      roleId: peer.roleId,
      conversationIds: ["cnv_operator01"],
      peers: [
        {
          ...peer,
          participantKeys: ["bot:999999999999999991", "user:999999999999999991"],
          participantId: "ptc_lervoagent01",
          roleId: "developer",
        },
      ],
    });
    const addressed = event("itg_discord01", [peer.participantId]);
    const { schemaVersion: _schemaVersion, eventId: _eventId, ...addressedContent } = addressed;
    const peerAddressed = createConversationInboundEvent({
      ...addressedContent,
      target: { ...addressed.target, integrationId: "itg_discord02" },
    });
    first.owns({ event: addressed, policy: policy("developer") });
    second.owns({ event: peerAddressed, policy: policy("researcher") });

    const followUp = event("itg_discord01");
    const { schemaVersion: _followUpVersion, eventId: _followUpId, ...followUpContent } = followUp;
    const peerFollowUp = createConversationInboundEvent({
      ...followUpContent,
      target: { ...followUp.target, integrationId: "itg_discord02" },
    });
    expect(first.owns({ event: followUp, policy: policy("developer") })).toBe(false);
    expect(second.owns({ event: peerFollowUp, policy: policy("researcher") })).toBe(true);
  });

  it("uses the CEO as the stable unaddressed general-channel owner", () => {
    const po = createDiscordConversationTurnOwnership({
      participantId: "ptc_lervoagent01",
      roleId: "product-owner",
      conversationIds: ["cnv_operator01"],
      peers: [{ ...peer, roleId: "ceo" }],
    });
    const ceo = createDiscordConversationTurnOwnership({
      participantId: peer.participantId,
      roleId: "ceo",
      conversationIds: ["cnv_operator01"],
      peers: [
        {
          ...peer,
          participantId: "ptc_lervoagent01",
          roleId: "product-owner",
        },
      ],
    });
    expect(po.owns({ event: event("itg_discord01"), policy: policy("product-owner") })).toBe(false);
    expect(ceo.owns({ event: event("itg_discord02"), policy: policy("ceo") })).toBe(true);
  });

  it("selects one non-source owner for an unaddressed agent contribution", () => {
    const ownership = createDiscordConversationTurnOwnership({
      participantId: "ptc_lervoagent01",
      roleId: "product-owner",
      conversationIds: ["cnv_operator01"],
      peers: [peer],
    });
    const source = event("itg_discord01");
    const { schemaVersion: _schemaVersion, eventId: _eventId, ...content } = source;
    const report = createConversationInboundEvent({
      ...content,
      actor: {
        kind: "agent",
        participantId: peer.participantId,
        roleId: peer.roleId,
        agentBinding: peer.agentBinding,
      },
      automationDepth: 1,
    });

    expect(ownership.owns({ event: report, policy: policy("product-owner") })).toBe(true);
  });

  it("releases a captured conversation after the addressed exchange goes idle", () => {
    const pair = () => {
      const first = createDiscordConversationTurnOwnership({
        participantId: "ptc_lervoagent01",
        roleId: "developer",
        conversationIds: ["cnv_operator01"],
        peers: [peer],
      });
      const second = createDiscordConversationTurnOwnership({
        participantId: peer.participantId,
        roleId: peer.roleId,
        conversationIds: ["cnv_operator01"],
        peers: [
          {
            ...peer,
            participantKeys: ["bot:999999999999999991", "user:999999999999999991"],
            participantId: "ptc_lervoagent01",
            roleId: "developer",
          },
        ],
      });
      return { first, second };
    };
    const unaddressed = (at: string) => {
      const source = event("itg_discord01", [], at);
      const { schemaVersion: _version, eventId: _id, ...content } = source;
      return {
        first: source,
        second: createConversationInboundEvent({
          ...content,
          target: { ...source.target, integrationId: "itg_discord02" },
        }),
      };
    };

    const captured = pair();
    const addressed = event("itg_discord01", [peer.participantId]);
    const { schemaVersion: _schemaVersion, eventId: _eventId, ...addressedContent } = addressed;
    captured.first.owns({ event: addressed, policy: policy("developer") });
    captured.second.owns({
      event: createConversationInboundEvent({
        ...addressedContent,
        target: { ...addressed.target, integrationId: "itg_discord02" },
      }),
      policy: policy("researcher"),
    });

    // The exchange continues, so the addressed interlocutor keeps the turn and renews its hold.
    const soon = unaddressed("2026-09-09T00:20:00.000Z");
    expect(captured.first.owns({ event: soon.first, policy: policy("developer") })).toBe(false);
    expect(captured.second.owns({ event: soon.second, policy: policy("researcher") })).toBe(true);

    // Renewal moved the bound, so a turn 25 minutes later is still inside it.
    const later = unaddressed("2026-09-09T00:45:00.000Z");
    expect(captured.second.owns({ event: later.second, policy: policy("researcher") })).toBe(true);

    // After an idle gap the capture lapses and the general unaddressed rule decides again.
    const idle = unaddressed("2026-09-09T01:30:00.000Z");
    const fresh = pair();
    expect(captured.first.owns({ event: idle.first, policy: policy("developer") })).toBe(
      fresh.first.owns({ event: idle.first, policy: policy("developer") }),
    );
    expect(captured.second.owns({ event: idle.second, policy: policy("researcher") })).toBe(
      fresh.second.owns({ event: idle.second, policy: policy("researcher") }),
    );
  });
});
