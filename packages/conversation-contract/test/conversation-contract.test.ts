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
});
