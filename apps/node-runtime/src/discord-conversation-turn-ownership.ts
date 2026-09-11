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
  const stickyOwners = new Map<string, string>();
  const current: ConversationTurnCandidate = {
    participantId: input.participantId,
    roleId: input.roleId,
    unaddressedPriority: input.roleId === "ceo" ? 100 : 0,
  };
  return {
    owns({ event }) {
      if (
        event.actor.kind === "agent" &&
        event.mentions.participantIds.length === 0 &&
        event.mentions.roleIds.length === 0
      ) {
        return false;
      }
      const candidates = [
        ...(input.conversationIds.includes(event.target.conversationId) ? [current] : []),
        ...input.peers.flatMap((peer) =>
          peer.conversationIds.includes(event.target.conversationId)
            ? [
                {
                  participantId: peer.participantId,
                  roleId: peer.roleId,
                  unaddressedPriority: peer.roleId === "ceo" ? 100 : 0,
                },
              ]
            : [],
        ),
      ];
      const addressKey = `${event.target.conversationId}\0${event.target.threadId ?? ""}`;
      const explicitlyAddressed =
        event.mentions.participantIds.length > 0 || event.mentions.roleIds.length > 0;
      const resolved = resolveConversationTurnOwnership({ event, candidates });
      if (explicitlyAddressed && resolved.ownerParticipantIds.length === 1) {
        if (stickyOwners.size >= 1_024 && !stickyOwners.has(addressKey)) {
          stickyOwners.delete(stickyOwners.keys().next().value!);
        }
        stickyOwners.set(addressKey, resolved.ownerParticipantIds[0]!);
      }
      const sticky = explicitlyAddressed ? null : stickyOwners.get(addressKey);
      return (
        sticky === null || sticky === undefined ? resolved.ownerParticipantIds : [sticky]
      ).includes(input.participantId);
    },
  };
}
