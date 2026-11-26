/** ADR-0641: room records keep identifiers, counts, and times only, never message text. */
export const roomPayloadAllowlists = {
  "room.participant.joined": [
    "workspaceId",
    "agentId",
    "providerSessionDigest",
    "mentionedBy",
    "occurredAt",
  ],
  "room.mention.recorded": [
    "workspaceId",
    "mentionId",
    "fromAgentId",
    "toAgentId",
    "depth",
    "occurredAt",
  ],
  "room.mention.delivered": ["mentionId", "providerSessionDigest", "occurredAt"],
  "room.mention.failed": ["mentionId", "code", "occurredAt"],
  "room.exchange.paused": ["workspaceId", "agentTurnCount", "limit", "openerAgentId", "occurredAt"],
} as const;
export const roomPayloadSchemas = {
  "room.participant.joined": "roomParticipantJoinedEventPayload",
  "room.mention.recorded": "roomMentionRecordedEventPayload",
  "room.mention.delivered": "roomMentionDeliveredEventPayload",
  "room.mention.failed": "roomMentionFailedEventPayload",
  "room.exchange.paused": "roomExchangePausedEventPayload",
} as const;
