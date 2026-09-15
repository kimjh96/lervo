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
  // ADR-0391 keeps a bounded in-memory owner. Bound it by idle event time so one explicit
  // address does not capture the conversation forever, and so every peer, reading the same
  // events, expires it identically.
  const stickyOwnerIdleMs = 30 * 60_000;
  const stickyOwners = new Map<string, { participantId: string; atMs: number }>();
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
      const atMs = Date.parse(event.occurredAt);
      if (explicitlyAddressed && resolved.ownerParticipantIds.length === 1) {
        if (stickyOwners.size >= 1_024 && !stickyOwners.has(addressKey)) {
          stickyOwners.delete(stickyOwners.keys().next().value!);
        }
        stickyOwners.set(addressKey, { participantId: resolved.ownerParticipantIds[0]!, atMs });
      }
      const retained = explicitlyAddressed ? undefined : stickyOwners.get(addressKey);
      // An unparsable time never expires an owner; it falls back to the retained selection.
      const expired =
        retained !== undefined &&
        Number.isFinite(atMs) &&
        Number.isFinite(retained.atMs) &&
        atMs - retained.atMs > stickyOwnerIdleMs;
      if (expired) stickyOwners.delete(addressKey);
      const sticky = expired ? undefined : retained;
      if (sticky !== undefined && Number.isFinite(atMs)) sticky.atMs = atMs;
      return (
        sticky === undefined ? resolved.ownerParticipantIds : [sticky.participantId]
      ).includes(input.participantId);
    },
  };
}
