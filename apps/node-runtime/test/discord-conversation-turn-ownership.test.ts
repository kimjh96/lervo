import {
  createConversationInboundEvent,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationInboundEvent } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { createDiscordConversationTurnOwnership } from "../src/discord-conversation-turn-ownership.js";
import { discordUnaddressedPriorityKey } from "../src/discord-conversation-priorities.js";

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

const secondPeer = {
  ...peer,
  participantKeys: ["bot:999999999999999993", "user:999999999999999993"],
  participantId: "ptc_thirdagent01",
  agentBinding: {
    ...peer.agentBinding,
    agentId: `agt_${"e".repeat(24)}`,
  },
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

function agentEvent(input: {
  participantIds?: string[];
  coordination?: ConversationInboundEvent["coordination"];
}) {
  const source = event("itg_discord01", input.participantIds ?? []);
  const { schemaVersion: _schemaVersion, eventId: _eventId, ...content } = source;
  return createConversationInboundEvent({
    ...content,
    actor: {
      kind: "agent",
      participantId: peer.participantId,
      roleId: peer.roleId,
      agentBinding: peer.agentBinding,
    },
    ...(input.coordination === undefined ? {} : { coordination: input.coordination }),
    automationDepth: 1,
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

  it("lets no local bot answer when the exact mentioned participant is not routable", () => {
    const ownership = createDiscordConversationTurnOwnership({
      participantId: "ptc_lervoagent01",
      roleId: "product-owner",
      conversationIds: ["cnv_operator01"],
      peers: [peer],
    });

    expect(
      ownership.owns({
        event: event("itg_discord01", ["ptc_unroutable01"]),
        policy: policy("product-owner"),
      }),
    ).toBe(false);
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

  it("uses the configured priority rather than a role-name special case", () => {
    const priorities = new Map([
      [discordUnaddressedPriorityKey("ptc_lervoagent01", "cnv_operator01"), 0],
      [discordUnaddressedPriorityKey(peer.participantId, "cnv_operator01"), 100],
    ]);
    const po = createDiscordConversationTurnOwnership({
      participantId: "ptc_lervoagent01",
      roleId: "product-owner",
      conversationIds: ["cnv_operator01"],
      peers: [{ ...peer, roleId: "ceo" }],
      unaddressedPriorities: priorities,
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
      unaddressedPriorities: priorities,
    });
    expect(po.owns({ event: event("itg_discord01"), policy: policy("product-owner") })).toBe(false);
    expect(ceo.owns({ event: event("itg_discord02"), policy: policy("ceo") })).toBe(true);
  });

  it("rejects an unaddressed agent turn before relevance or provider execution", () => {
    const ownership = createDiscordConversationTurnOwnership({
      participantId: "ptc_lervoagent01",
      roleId: "product-owner",
      conversationIds: ["cnv_operator01"],
      peers: [peer, secondPeer],
    });

    expect(ownership.owns({ event: agentEvent({}), policy: policy("product-owner") })).toBe(false);
  });

  it("accepts one exact agent address and rejects ambiguous uncoordinated fan-out", () => {
    const ownership = createDiscordConversationTurnOwnership({
      participantId: "ptc_lervoagent01",
      roleId: "product-owner",
      conversationIds: ["cnv_operator01"],
      peers: [peer, secondPeer],
    });
    const current = "ptc_lervoagent01";

    expect(
      ownership.owns({
        event: agentEvent({ participantIds: [current] }),
        policy: policy("product-owner"),
      }),
    ).toBe(true);
    expect(
      ownership.owns({
        event: agentEvent({ participantIds: [current, secondPeer.participantId] }),
        policy: policy("product-owner"),
      }),
    ).toBe(false);
  });

  it("serializes an authenticated discussion assignment to its first exact target", () => {
    const ownership = createDiscordConversationTurnOwnership({
      participantId: "ptc_lervoagent01",
      roleId: "product-owner",
      conversationIds: ["cnv_operator01"],
      peers: [peer],
    });

    expect(
      ownership.owns({
        event: agentEvent({
          participantIds: ["ptc_lervoagent01", "ptc_thirdagent01"],
          coordination: {
            kind: "discussion.assignment",
            discussionId: "dsc_abcdefghijklmnopqrst",
            activeParticipantId: "ptc_lervoagent01",
          },
        }),
        policy: policy("product-owner"),
      }),
    ).toBe(true);
    expect(
      ownership.owns({
        event: agentEvent({
          participantIds: ["ptc_thirdagent01", "ptc_lervoagent01"],
          coordination: {
            kind: "discussion.assignment",
            discussionId: "dsc_abcdefghijklmnopqrst",
            activeParticipantId: "ptc_thirdagent01",
          },
        }),
        policy: policy("product-owner"),
      }),
    ).toBe(false);
  });

  it("routes a discussion contribution to the durable coordinator instead of its reply mention", () => {
    const contribution = agentEvent({
      participantIds: ["ptc_lervoagent01"],
      coordination: {
        kind: "discussion.contribution",
        discussionId: "dsc_abcdefghijklmnopqrst",
      },
    });
    const coordinator = createDiscordConversationTurnOwnership({
      participantId: "ptc_coordinator01",
      roleId: "ceo",
      conversationIds: ["cnv_operator01"],
      peers: [peer],
      discussion: { ownsCoordinationTurn: () => true },
    });
    const mentionedNonCoordinator = createDiscordConversationTurnOwnership({
      participantId: "ptc_lervoagent01",
      roleId: "product-owner",
      conversationIds: ["cnv_operator01"],
      peers: [peer],
      discussion: { ownsCoordinationTurn: () => false },
    });

    expect(coordinator.owns({ event: contribution, policy: policy("ceo") })).toBe(true);
    expect(
      mentionedNonCoordinator.owns({
        event: contribution,
        policy: policy("product-owner"),
      }),
    ).toBe(false);
  });

  it("routes a delegated-task result only to its authenticated coordinator", () => {
    const result = agentEvent({
      participantIds: ["ptc_lervoagent01", "ptc_thirdagent01"],
      coordination: {
        kind: "task.result",
        taskId: `tsk_${"t".repeat(20)}`,
        coordinatorParticipantId: "ptc_lervoagent01",
      },
    });
    const coordinator = createDiscordConversationTurnOwnership({
      participantId: "ptc_lervoagent01",
      roleId: "product-owner",
      conversationIds: ["cnv_operator01"],
      peers: [peer, secondPeer],
      discussion: { ownsCoordinationTurn: () => null },
    });
    const other = createDiscordConversationTurnOwnership({
      participantId: secondPeer.participantId,
      roleId: secondPeer.roleId,
      conversationIds: ["cnv_operator01"],
      peers: [peer, { ...secondPeer, participantId: "ptc_lervoagent01" }],
    });

    expect(coordinator.owns({ event: result, policy: policy("product-owner") })).toBe(true);
    expect(other.owns({ event: result, policy: policy(secondPeer.roleId) })).toBe(false);
  });

  it("routes an authenticated delegated-task assignment through ordinary exact ownership", () => {
    const current = "ptc_lervoagent01";
    const assignment = agentEvent({
      participantIds: [current],
      coordination: {
        kind: "task.assignment",
        taskId: `tsk_${"a".repeat(20)}`,
        coordinatorParticipantId: peer.participantId,
      },
    });
    const ownership = createDiscordConversationTurnOwnership({
      participantId: current,
      roleId: "product-owner",
      conversationIds: ["cnv_operator01"],
      peers: [peer],
      discussion: { ownsCoordinationTurn: () => null },
    });

    expect(ownership.owns({ event: assignment, policy: policy("product-owner") })).toBe(true);
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
