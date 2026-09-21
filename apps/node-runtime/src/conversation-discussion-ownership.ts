import type { ConversationAgentBinding, ConversationInboundEvent } from "@lervo/schemas";

import { exactDiscussionPeer } from "./conversation-discussion-protocol.js";
import type { StoredConversationDiscussion } from "./conversation-discussion-store.js";
import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";
import { sameConversationAgentBinding } from "./conversation-discussion-evidence.js";

export function ownsConversationDiscussionTurn(input: {
  event: ConversationInboundEvent;
  participantId: string;
  agentBinding: ConversationAgentBinding | null;
  peers: readonly DiscordPeerAgentBinding[];
  discussion: StoredConversationDiscussion | null;
}): boolean | null {
  const coordination = input.event.coordination;
  if (coordination === undefined) return null;
  if (coordination.kind === "discussion.assignment") {
    return (
      exactDiscussionPeer({ event: input.event, peers: input.peers }) !== null &&
      input.agentBinding !== null &&
      coordination.activeParticipantId === input.participantId &&
      input.event.mentions.participantIds.includes(input.participantId)
    );
  }
  if (coordination.kind === "discussion.contribution") {
    return (
      exactDiscussionPeer({ event: input.event, peers: input.peers }) !== null &&
      input.discussion !== null &&
      input.agentBinding !== null &&
      input.discussion.envelope.source.participantId === input.participantId &&
      sameConversationAgentBinding(
        input.discussion.envelope.source.agentBinding,
        input.agentBinding,
      ) &&
      input.event.replyToEventId === input.discussion.originEventId
    );
  }
  if (coordination.kind === "discussion.decision") {
    return (
      input.event.kind === "signal.raised" &&
      input.event.signalCode === "discussion.deadline" &&
      input.event.actor.kind === "system" &&
      input.event.actor.participantId === "ptc_lervo_system" &&
      input.discussion !== null &&
      input.discussion.envelope.source.participantId === input.participantId &&
      input.event.mentions.participantIds.includes(input.participantId) &&
      input.event.replyToEventId === input.discussion.originEventId
    );
  }
  // Coordination protocols outside natural discussion retain their own ownership rules.
  return null;
}
