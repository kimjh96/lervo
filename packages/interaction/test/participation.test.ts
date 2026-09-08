import { describe, expect, it } from "vitest";

import {
  createConversationInboundEvent,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";

import { decideConversationParticipation, requiresConversationRelevance } from "../src/index.js";

function event(
  input: {
    mentioned?: boolean;
    mentionedParticipant?: boolean;
    kind?: "message.created" | "signal.raised";
    signalCode?: string | null;
    actorKind?: "human" | "agent" | "system";
    automationDepth?: number;
  } = {},
) {
  const actorKind = input.actorKind ?? "human";
  return createConversationInboundEvent({
    sourceEventKeyHash: hashConversationSourceEventKey("source-1"),
    target: {
      integrationId: "itg_native001",
      projectId: "prj_project01",
      conversationId: "cnv_general01",
      threadId: null,
    },
    kind: input.kind ?? "message.created",
    actor: {
      kind: actorKind,
      participantId: actorKind === "agent" ? "ptc_agent002" : "ptc_human001",
      roleId: actorKind === "agent" ? "role_writer" : null,
    },
    content: {
      artifactId: "art_message01",
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      byteCount: 12,
      mediaType: "text/plain; charset=utf-8",
    },
    mentions: {
      roleIds: input.mentioned ? ["role_reviewer"] : [],
      participantIds: input.mentionedParticipant ? ["ptc_agent001"] : [],
    },
    replyToEventId: null,
    signalCode: input.signalCode ?? null,
    automationDepth: input.automationDepth ?? 0,
    occurredAt: "2026-08-20T00:00:01.000Z",
  });
}

function policy(
  input: {
    mode?: "mention_only" | "relevant" | "proactive" | "silent";
    cooldownSeconds?: number;
    maxResponsesPerHour?: number;
    maxAutomationDepth?: number;
    conversationIds?: string[];
  } = {},
) {
  return createConversationParticipationPolicy({
    projectId: "prj_project01",
    roleId: "role_reviewer",
    conversationIds: input.conversationIds ?? ["cnv_general01"],
    mode: input.mode ?? "relevant",
    respondTo: ["human"],
    signalCodes: ["review.requested"],
    cooldownSeconds: input.cooldownSeconds ?? 0,
    maxResponsesPerHour: input.maxResponsesPerHour ?? 5,
    maxAutomationDepth: input.maxAutomationDepth ?? 2,
    createdAt: "2026-08-20T00:00:00.000Z",
  });
}

function decide(input: {
  event?: ReturnType<typeof event>;
  policy?: ReturnType<typeof policy>;
  relevance?: "not_checked" | "relevant" | "not_relevant" | "unknown";
  latestResponseAt?: string | null;
  responsesInLastHour?: number;
  agentParticipantId?: string;
}) {
  return decideConversationParticipation({
    event: input.event ?? event(),
    policy: input.policy ?? policy(),
    ...(input.agentParticipantId === undefined
      ? {}
      : { agentParticipantId: input.agentParticipantId }),
    relevance: input.relevance ?? "not_checked",
    window: {
      latestResponseAt: input.latestResponseAt ?? null,
      responsesInLastHour: input.responsesInLastHour ?? 0,
    },
    decidedAt: "2026-08-20T00:00:10.000Z",
  });
}

describe("conversation participation", () => {
  it("keeps an unmentioned mention-only message as observation", () => {
    const result = decide({ policy: policy({ mode: "mention_only" }) });
    expect(result).toMatchObject({ action: "observe", reason: "not_mentioned" });
  });

  it("responds to an explicit mention without a relevance claim", () => {
    const result = decide({ event: event({ mentioned: true }), relevance: "unknown" });
    expect(result).toMatchObject({
      action: "respond",
      reason: "mentioned",
      relevance: "not_checked",
    });
  });

  it("treats the exact agent participant mention as addressed without semantic relevance", () => {
    const addressed = event({ mentionedParticipant: true });
    expect(
      requiresConversationRelevance({
        event: addressed,
        policy: policy(),
        agentParticipantId: "ptc_agent001",
      }),
    ).toBe(false);
    expect(
      decide({
        event: addressed,
        agentParticipantId: "ptc_agent001",
        relevance: "unknown",
      }),
    ).toMatchObject({ action: "respond", reason: "mentioned", relevance: "not_checked" });
  });

  it("responds to a relevant unmentioned message and observes unknown relevance", () => {
    expect(requiresConversationRelevance({ event: event(), policy: policy() })).toBe(true);
    expect(decide({ relevance: "relevant" })).toMatchObject({
      action: "respond",
      reason: "relevant",
    });
    expect(decide({ relevance: "unknown" })).toMatchObject({
      action: "observe",
      reason: "relevance_unavailable",
    });
  });

  it("responds only to subscribed proactive signals", () => {
    const subscribed = event({ kind: "signal.raised", signalCode: "review.requested" });
    const ignored = event({ kind: "signal.raised", signalCode: "build.completed" });
    expect(decide({ event: subscribed, policy: policy({ mode: "proactive" }) })).toMatchObject({
      action: "respond",
      reason: "proactive_signal",
    });
    expect(decide({ event: ignored, policy: policy({ mode: "proactive" }) })).toMatchObject({
      action: "observe",
      reason: "signal_not_subscribed",
    });
  });

  it("applies automation depth, cooldown, and hourly response bounds", () => {
    expect(
      requiresConversationRelevance({
        event: event({ automationDepth: 2 }),
        policy: policy({ maxAutomationDepth: 2 }),
      }),
    ).toBe(false);
    expect(
      requiresConversationRelevance({
        event: event({ actorKind: "agent" }),
        policy: policy(),
      }),
    ).toBe(false);
    expect(
      decide({
        event: event({ mentioned: true, automationDepth: 2 }),
        policy: policy({ maxAutomationDepth: 2 }),
      }),
    ).toMatchObject({ action: "observe", reason: "automation_depth_exceeded" });
    expect(
      decide({
        event: event({ mentioned: true }),
        policy: policy({ cooldownSeconds: 60 }),
        latestResponseAt: "2026-08-20T00:00:00.000Z",
      }),
    ).toMatchObject({ action: "observe", reason: "cooldown" });
    expect(
      decide({
        event: event({ mentioned: true }),
        policy: policy({ maxResponsesPerHour: 1 }),
        responsesInLastHour: 1,
      }),
    ).toMatchObject({ action: "observe", reason: "rate_limited" });
  });

  it("rejects a policy that does not cover the conversation before work starts", () => {
    const other = policy({ conversationIds: ["cnv_other001"] });
    expect(() => decide({ policy: other })).toThrow(/coordinates/);
  });
});
