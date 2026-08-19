import { canonicalJson } from "@lervo/event-contract";
import { type ConversationInboundEvent, validateSchema } from "@lervo/schemas";

import { ConversationContractError } from "./errors.js";
import { clone, digest, sortedUnique } from "./shared.js";

type EventContent = Omit<ConversationInboundEvent, "eventId">;

export function hashConversationSourceEventKey(sourceEventKey: string): string {
  if (sourceEventKey.length < 1 || sourceEventKey.length > 512) {
    throw new ConversationContractError(
      "invalid_conversation_event",
      "Conversation source event key 길이가 유효하지 않습니다.",
    );
  }
  return digest(sourceEventKey);
}

export function calculateConversationEventId(content: EventContent): string {
  return `cve_${digest(canonicalJson(clone(content))).slice("sha256:".length)}`;
}

export function createConversationInboundEvent(
  input: Omit<EventContent, "schemaVersion">,
): ConversationInboundEvent {
  const content: EventContent = {
    schemaVersion: 1,
    ...clone(input),
    mentions: {
      roleIds: [...input.mentions.roleIds].sort(),
      participantIds: [...input.mentions.participantIds].sort(),
    },
  };
  const event = { ...content, eventId: calculateConversationEventId(content) };
  assertConversationInboundEvent(event);
  return clone(event);
}

export function assertConversationInboundEvent(event: ConversationInboundEvent): void {
  if (!validateSchema("conversationInboundEvent", event).valid) {
    throw new ConversationContractError(
      "invalid_conversation_event",
      "Conversation inbound event 계약이 유효하지 않습니다.",
    );
  }
  const { eventId: _eventId, ...content } = event;
  if (
    event.eventId !== calculateConversationEventId(content) ||
    !sortedUnique(event.mentions.roleIds) ||
    !sortedUnique(event.mentions.participantIds)
  ) {
    throw new ConversationContractError(
      "invalid_conversation_event",
      "Conversation event ID 또는 mention 순서가 원본과 다릅니다.",
    );
  }
}
