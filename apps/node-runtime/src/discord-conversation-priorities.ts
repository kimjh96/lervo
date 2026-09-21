import type { NodeDiscordConversationConfig } from "./config-types.js";
import { NodeRuntimeError } from "./errors.js";

export function discordUnaddressedPriorityKey(
  participantId: string,
  conversationId: string,
): string {
  return `${conversationId}\0${participantId}`;
}

export function resolveDiscordUnaddressedPriorities(
  configs: readonly NodeDiscordConversationConfig[],
): ReadonlyMap<string, number> {
  const priorities = new Map<string, number>();
  const add = (participantId: string, conversationId: string, priority: number) => {
    const key = discordUnaddressedPriorityKey(participantId, conversationId);
    const current = priorities.get(key);
    if (current !== undefined && current !== priority) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Discord participant priorities differ between deployment bindings.",
      );
    }
    priorities.set(key, priority);
  };
  for (const config of configs) {
    for (const conversation of config.conversations) {
      add(
        config.agentParticipantId,
        conversation.conversationId,
        config.policy?.unaddressedPriorities?.[conversation.conversationId] ??
          config.policy?.unaddressedPriority ??
          0,
      );
    }
    for (const peer of config.peerAgents ?? []) {
      for (const conversationId of peer.conversationIds) {
        const priority = peer.unaddressedPriorities?.[conversationId] ?? peer.unaddressedPriority;
        if (priority !== undefined) add(peer.participantId, conversationId, priority);
      }
    }
  }
  return priorities;
}
