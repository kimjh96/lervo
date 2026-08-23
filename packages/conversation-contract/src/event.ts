import { canonicalJson } from "@lervo/event-contract";
import { type ConversationInboundEvent, validateSchema } from "@lervo/schemas";

import { ConversationContractError } from "./errors.js";
import { clone, digest, sortedUnique } from "./shared.js";

type EventContent = Omit<ConversationInboundEvent, "eventId">;

export function hashConversationSourceEventKey(sourceEventKey: string): string {
  if (sourceEventKey.length < 1 || sourceEventKey.length > 512) {
    throw new ConversationContractError(
      "invalid_conversation_event",
      "The conversation source event key length is invalid.",
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
      "The conversation inbound event contract is invalid.",
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
      "The conversation event ID or mention order differs from the source.",
    );
  }
}
