import {
  assertConversationInboundEvent,
  assertConversationParticipationPolicy,
  createConversationParticipationDecision,
} from "@lervo/conversation-contract";
import type {
  ConversationInboundEvent,
  ConversationParticipationDecision,
  ConversationParticipationPolicy,
} from "@lervo/schemas";

import { InteractionError } from "./errors.js";
import type { ParticipationWindow } from "./types.js";

export function assertConversationParticipationScope(input: {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  at: string;
}): void {
  assertConversationInboundEvent(input.event);
  assertConversationParticipationPolicy(input.policy);
  const atMs = Date.parse(input.at);
  if (
    input.event.target.projectId !== input.policy.projectId ||
    !input.policy.conversationIds.includes(input.event.target.conversationId) ||
    !Number.isFinite(atMs) ||
    atMs < Date.parse(input.event.occurredAt) ||
    atMs < Date.parse(input.policy.createdAt)
  ) {
    throw new InteractionError(
      "invalid_interaction_request",
      "The conversation participation coordinates or time are invalid.",
    );
  }
}

export function requiresConversationRelevance(input: {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  agentParticipantId?: string;
  window?: ParticipationWindow;
  at?: string;
}): boolean {
  if (
    !input.policy.respondTo.includes(input.event.actor.kind) ||
    input.event.automationDepth + 1 > input.policy.maxAutomationDepth ||
    (input.window !== undefined &&
      input.window.responsesInLastHour >= input.policy.maxResponsesPerHour) ||
    (input.window?.latestResponseAt !== null &&
      input.window?.latestResponseAt !== undefined &&
      input.at !== undefined &&
      Date.parse(input.at) <
        Date.parse(input.window.latestResponseAt) + input.policy.cooldownSeconds * 1_000)
  )
    return false;
  return (
    input.event.kind === "message.created" &&
    !input.event.mentions.roleIds.includes(input.policy.roleId) &&
    (input.agentParticipantId === undefined ||
      !input.event.mentions.participantIds.includes(input.agentParticipantId)) &&
    (input.policy.mode === "relevant" || input.policy.mode === "proactive")
  );
}

export function decideConversationParticipation(input: {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  relevance: ConversationParticipationDecision["relevance"];
  agentParticipantId?: string;
  window: ParticipationWindow;
  decidedAt: string;
}): ConversationParticipationDecision {
  assertConversationParticipationScope({
    event: input.event,
    policy: input.policy,
    at: input.decidedAt,
  });
  const decidedAtMs = Date.parse(input.decidedAt);
  if (
    !Number.isSafeInteger(input.window.responsesInLastHour) ||
    input.window.responsesInLastHour < 0 ||
    (input.window.latestResponseAt !== null &&
      !Number.isFinite(Date.parse(input.window.latestResponseAt)))
  ) {
    throw new InteractionError(
      "invalid_interaction_request",
      "The conversation participation coordinates, time, or window are invalid.",
    );
  }

  let reason: ConversationParticipationDecision["reason"];
  let relevance = input.relevance;
  if (input.policy.mode === "silent") {
    reason = "silent";
    relevance = "not_checked";
  } else if (!input.policy.respondTo.includes(input.event.actor.kind)) {
    reason = "actor_not_allowed";
    relevance = "not_checked";
  } else if (input.event.automationDepth + 1 > input.policy.maxAutomationDepth) {
    reason = "automation_depth_exceeded";
    relevance = "not_checked";
  } else if (input.event.kind === "signal.raised") {
    if (
      input.policy.mode === "proactive" &&
      input.event.signalCode !== null &&
      input.policy.signalCodes.includes(input.event.signalCode)
    ) {
      reason = "proactive_signal";
      relevance = "not_checked";
    } else {
      reason = "signal_not_subscribed";
      relevance = "not_checked";
    }
  } else if (
    input.event.mentions.roleIds.includes(input.policy.roleId) ||
    (input.agentParticipantId !== undefined &&
      input.event.mentions.participantIds.includes(input.agentParticipantId))
  ) {
    reason = "mentioned";
    relevance = "not_checked";
  } else if (input.policy.mode === "mention_only") {
    reason = "not_mentioned";
    relevance = "not_checked";
  } else if (input.relevance === "relevant") {
    reason = "relevant";
  } else if (input.relevance === "not_relevant") {
    reason = "not_relevant";
  } else {
    reason = "relevance_unavailable";
    relevance = "unknown";
  }

  const triggered =
    reason === "mentioned" || reason === "relevant" || reason === "proactive_signal";
  if (triggered && input.window.latestResponseAt !== null) {
    const cooldownUntil =
      Date.parse(input.window.latestResponseAt) + input.policy.cooldownSeconds * 1_000;
    if (decidedAtMs < cooldownUntil) {
      reason = "cooldown";
      relevance = "not_checked";
    }
  }
  if (
    triggered &&
    reason !== "cooldown" &&
    input.window.responsesInLastHour >= input.policy.maxResponsesPerHour
  ) {
    reason = "rate_limited";
    relevance = "not_checked";
  }
  return createConversationParticipationDecision({
    event: input.event,
    policy: input.policy,
    action:
      reason === "mentioned" || reason === "relevant" || reason === "proactive_signal"
        ? "respond"
        : "observe",
    reason,
    relevance,
    decidedAt: input.decidedAt,
  });
}
