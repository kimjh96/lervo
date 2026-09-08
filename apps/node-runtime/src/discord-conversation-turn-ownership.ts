import {
  resolveConversationTurnOwnership,
  type ConversationTurnCandidate,
} from "@lervo/conversation-contract";
import type { ConversationTurnOwnershipEvaluator } from "@lervo/interaction";

import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";

export function createDiscordConversationTurnOwnership(input: {
  participantId: string;
  roleId: string;
  conversationIds: readonly string[];
  peers: readonly DiscordPeerAgentBinding[];
}): ConversationTurnOwnershipEvaluator {
  const current: ConversationTurnCandidate = {
    participantId: input.participantId,
    roleId: input.roleId,
  };
  return {
    owns({ event }) {
      const candidates = [
        ...(input.conversationIds.includes(event.target.conversationId) ? [current] : []),
        ...input.peers.flatMap((peer) =>
          peer.conversationIds.includes(event.target.conversationId)
            ? [{ participantId: peer.participantId, roleId: peer.roleId }]
            : [],
        ),
      ];
      return resolveConversationTurnOwnership({ event, candidates }).ownerParticipantIds.includes(
        input.participantId,
      );
    },
  };
}
