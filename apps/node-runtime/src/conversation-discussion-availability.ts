import type { ManagedConversationSurfaceEffect } from "@lervo/conversation-responder";

import type { ConversationRequestedEffect } from "./conversation-intent-resolver.js";
import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";
import { selectConversationDiscussionParticipants } from "./conversation-discussion-protocol.js";

/** Only channels with two independently bound bot peers can start a distributed discussion. */
export function eligibleDiscussionConversationIds(
  conversationIds: readonly string[],
  peers: readonly DiscordPeerAgentBinding[],
): string[] {
  return conversationIds.filter(
    (conversationId) =>
      selectConversationDiscussionParticipants({
        sourceEventId: "surface-availability",
        conversationId,
        peers,
      }).length === 2,
  );
}

export function availableDiscussionSurfaceEffects(
  effects: readonly ManagedConversationSurfaceEffect[],
  eligible: boolean,
): ManagedConversationSurfaceEffect[] {
  return eligible
    ? [...effects]
    : effects.filter((effect) => effect.effectId !== "deliberation_start");
}

export function availableDiscussionIntentEffects(
  effects: readonly ConversationRequestedEffect["kind"][],
  eligible: boolean,
): ConversationRequestedEffect["kind"][] {
  return eligible ? [...effects] : effects.filter((effect) => effect !== "deliberation_start");
}
