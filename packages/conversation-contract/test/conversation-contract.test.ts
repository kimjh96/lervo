import { describe, expect, it } from "vitest";

import type { WritingPublicationPermit } from "@lervo/schemas";
import { calculateWritingPublicationPermitId } from "@lervo/writing-contract";

import {
  assertConversationInboundEvent,
  assertConversationOutboundMessage,
  createConversationInboundEvent,
  createConversationOutboundMessage,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
  resolveConversationTurnOwnership,
} from "../src/index.js";

const inboundContent = {
  artifactId: "art_message01",
  contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  byteCount: 17,
  mediaType: "text/plain; charset=utf-8" as const,
};

const replyContent = {
  artifactId: "art_response1",
  contentHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  byteCount: 22,
  mediaType: "text/plain; charset=utf-8" as const,
};

function permit(surface: WritingPublicationPermit["surface"] = "chat"): WritingPublicationPermit {
  const content: Omit<WritingPublicationPermit, "permitId"> = {
    schemaVersion: 1,
    surface,
    artifactId: replyContent.artifactId,
    contentHash: replyContent.contentHash,
    writingPolicyId: "writing_korean_chat",
    writingPolicyHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    evaluationId: "wre_evaluate01",
    evaluationHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    issuedAt: "2026-08-20T00:00:02.000Z",
  };
  return { ...content, permitId: calculateWritingPublicationPermitId(content) };
}

function event() {
  return createConversationInboundEvent({
    sourceEventKeyHash: hashConversationSourceEventKey("native/raw/message/42"),
    target: {
      integrationId: "itg_native001",
      projectId: "prj_project01",
      conversationId: "cnv_general01",
      threadId: null,
    },
    kind: "message.created",
    actor: { kind: "human", participantId: "ptc_human001", roleId: null },
    content: inboundContent,
    mentions: { roleIds: [], participantIds: [] },
    replyToEventId: null,
    signalCode: null,
    automationDepth: 0,
    occurredAt: "2026-08-20T00:00:01.000Z",
  });
}

function policy() {
  return createConversationParticipationPolicy({
    projectId: "prj_project01",
    roleId: "role_reviewer",
    conversationIds: ["cnv_general01"],
    mode: "relevant",
    respondTo: ["human"],
    signalCodes: [],
    cooldownSeconds: 0,
    maxResponsesPerHour: 4,
    maxAutomationDepth: 2,
    createdAt: "2026-08-20T00:00:00.000Z",
  });
}

describe("conversation contract", () => {
  it("normalizes source identity to a hash and canonicalizes mentions", () => {
    const { schemaVersion: _schemaVersion, eventId: _eventId, ...base } = event();
    const value = createConversationInboundEvent({
      ...base,
      sourceEventKeyHash: hashConversationSourceEventKey("another-raw-key"),
      mentions: {
        roleIds: ["role_writer", "role_reviewer"],
        participantIds: ["ptc_writer01", "ptc_agent001"],
      },
    });

    expect(value.mentions.roleIds).toEqual(["role_reviewer", "role_writer"]);
    expect(value.mentions.participantIds).toEqual(["ptc_agent001", "ptc_writer01"]);
    expect(JSON.stringify(value)).not.toContain("another-raw-key");
  });

  it("rejects a changed canonical event identity", () => {
    const value = event();
    expect(() =>
      assertConversationInboundEvent({
        ...value,
        sourceEventKeyHash: hashConversationSourceEventKey("tampered"),
      }),
    ).toThrow(/ID/);
  });

  it("requires a content-bound chat publication permit", () => {
    const source = event();
    const participation = policy();
    const outbound = createConversationOutboundMessage({
      event: source,
      policy: participation,
      participantId: "ptc_agent001",
      content: replyContent,
      publicationPermit: permit(),
      createdAt: "2026-08-20T00:00:02.000Z",
    });

    expect(outbound.publicationPermit.surface).toBe("chat");
    expect(outbound.deliveryRelation).toBe("standalone");
    expect(
      createConversationOutboundMessage({
        event: source,
        policy: participation,
        participantId: "ptc_agent001",
        content: replyContent,
        publicationPermit: permit(),
        deliveryRelation: "reply",
        createdAt: "2026-08-20T00:00:02.000Z",
      }).deliveryRelation,
    ).toBe("reply");
    expect(() =>
      createConversationOutboundMessage({
        event: source,
        policy: participation,
        participantId: "ptc_agent001",
        content: replyContent,
        publicationPermit: permit("status"),
        createdAt: "2026-08-20T00:00:02.000Z",
      }),
    ).toThrow(/permit/);
    expect(() =>
      assertConversationOutboundMessage({
        outbound: {
          ...outbound,
          content: { ...outbound.content, artifactId: "art_changed01" },
        },
        event: source,
        policy: participation,
      }),
    ).toThrow(/ID|permit/);
  });

  it("assigns one stable owner for an unaddressed turn across adapter identities", () => {
    const source = event();
    const candidates = [
      { participantId: "ptc_agent001", roleId: "developer" },
      { participantId: "ptc_agent002", roleId: "researcher" },
    ];
    const first = resolveConversationTurnOwnership({ event: source, candidates });
    const { schemaVersion: _schemaVersion, eventId: _eventId, ...content } = source;
    const second = resolveConversationTurnOwnership({
      event: createConversationInboundEvent({
        ...content,
        target: { ...content.target, integrationId: "itg_discord02" },
      }),
      candidates: [...candidates].reverse(),
    });

    expect(first).toMatchObject({ basis: "unaddressed" });
    expect(first.ownerParticipantIds).toHaveLength(1);
    expect(second.ownerParticipantIds).toEqual(first.ownerParticipantIds);
  });

  it("keeps unaddressed turns with the preferred conversation owner", () => {
    const candidates = [
      { participantId: "ptc_agent001", roleId: "product-owner", unaddressedPriority: 0 },
      { participantId: "ptc_agent002", roleId: "ceo", unaddressedPriority: 100 },
    ];
    expect(resolveConversationTurnOwnership({ event: event(), candidates })).toMatchObject({
      basis: "unaddressed",
      ownerParticipantIds: ["ptc_agent002"],
    });
  });

  it("accepts a bounded multi-agent automation depth above one exchange", () => {
    expect(
      createConversationParticipationPolicy({
        projectId: "prj_project01",
        roleId: "role_reviewer",
        conversationIds: ["cnv_general01"],
        mode: "relevant",
        respondTo: ["human", "agent"],
        signalCodes: [],
        cooldownSeconds: 0,
        maxResponsesPerHour: 8,
        maxAutomationDepth: 8,
        createdAt: "2026-08-20T00:00:00.000Z",
      }),
    ).toMatchObject({ maxAutomationDepth: 8 });
  });

  it("honors exact participant mentions and selects one owner per mentioned role", () => {
    const source = event();
    const candidates = [
      { participantId: "ptc_agent001", roleId: "developer" },
      { participantId: "ptc_agent002", roleId: "researcher" },
      { participantId: "ptc_agent003", roleId: "researcher" },
    ];
    const { schemaVersion: _schemaVersion, eventId: _eventId, ...content } = source;
    const participantMention = createConversationInboundEvent({
      ...content,
      mentions: { roleIds: ["researcher"], participantIds: ["ptc_agent001"] },
    });
    const roleMention = createConversationInboundEvent({
      ...content,
      mentions: { roleIds: ["developer", "researcher"], participantIds: [] },
    });

    expect(
      resolveConversationTurnOwnership({ event: participantMention, candidates }),
    ).toMatchObject({
      basis: "participant_mentions",
      ownerParticipantIds: ["ptc_agent001"],
    });
    const roleOwners = resolveConversationTurnOwnership({ event: roleMention, candidates });
    expect(roleOwners.basis).toBe("role_mentions");
    expect(roleOwners.ownerParticipantIds).toContain("ptc_agent001");
    expect(roleOwners.ownerParticipantIds).toHaveLength(2);
  });
});
