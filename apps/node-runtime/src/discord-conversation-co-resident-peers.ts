import type { NodeDiscordConversationConfig } from "./config-types.js";
import type { DiscordAgentParticipation } from "./discord-agent-participation.js";
import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";
import { discordSpeakerParticipantKeys } from "./discord-conversation-speaker.js";
import { NodeRuntimeError } from "./errors.js";

function manualParticipantKey(
  participant: NodeDiscordConversationConfig["participants"][number],
): string {
  return `${participant.actorKind === "agent" ? "bot" : "user"}:${participant.userId}`;
}

export function createCoResidentDiscordPeerAgents(input: {
  configs: readonly NodeDiscordConversationConfig[];
  participations: readonly DiscordAgentParticipation[];
  currentIndex: number;
}): DiscordPeerAgentBinding[] {
  const conversation = input.configs[input.currentIndex];
  if (conversation === undefined || input.participations.length !== input.configs.length) {
    throw new NodeRuntimeError("invalid_config", "Discord co-resident agents are invalid.");
  }
  const manualParticipants = new Map(
    conversation.participants.map((participant) => [
      `${participant.tenantKey}\0${manualParticipantKey(participant)}`,
      participant,
    ]),
  );
  return input.configs.flatMap((peer, peerIndex) => {
    if (peerIndex === input.currentIndex) return [];
    const participation = input.participations[peerIndex];
    if (participation?.agentBinding === undefined) {
      throw new NodeRuntimeError(
        "invalid_config",
        "A co-resident Discord agent requires a hired-agent binding.",
      );
    }
    const participantKeys = discordSpeakerParticipantKeys(peer);
    const tenantKeys = conversation.allowedGuildIds.filter((tenantKey) => {
      if (!peer.allowedGuildIds.includes(tenantKey)) return false;
      const overrides = participantKeys.flatMap((key) => {
        const participant = manualParticipants.get(`${tenantKey}\0${key}`);
        return participant === undefined ? [] : [participant];
      });
      if (overrides.length === 0) return true;
      if (
        overrides.some(
          (participant) =>
            participant.actorKind !== "agent" ||
            participant.participantId !== peer.agentParticipantId ||
            participant.roleId !== participation.roleId ||
            participant.startsAutomationChain !== true,
        )
      ) {
        throw new NodeRuntimeError(
          "invalid_config",
          "A manual Discord chain starter must match its co-resident hired agent.",
        );
      }
      return true;
    });
    if (tenantKeys.length === 0) return [];
    const configured = conversation.peerAgents?.find(
      (candidate) => candidate.participantId === peer.agentParticipantId,
    );
    if (configured !== undefined) {
      if (
        configured.roleId !== participation.roleId ||
        configured.agentBinding.agentId !== participation.agentBinding.agentId ||
        participantKeys.some((key) => !configured.participantKeys.includes(key)) ||
        tenantKeys.some((tenantKey) => !configured.tenantKeys.includes(tenantKey))
      ) {
        throw new NodeRuntimeError(
          "invalid_config",
          "A configured and co-resident Discord peer-agent binding differs.",
        );
      }
      return [];
    }
    return [
      {
        ...(participation.displayName === null ? {} : { displayName: participation.displayName }),
        participantKeys,
        participantId: peer.agentParticipantId,
        roleId: participation.roleId,
        agentBinding: participation.agentBinding,
        tenantKeys,
        conversationIds: peer.conversations.flatMap((peerBinding) =>
          conversation.conversations.some(
            (binding) =>
              binding.tenantKey === peerBinding.tenantKey &&
              tenantKeys.includes(binding.tenantKey) &&
              binding.conversationKey === peerBinding.conversationKey &&
              binding.conversationId === peerBinding.conversationId,
          )
            ? [peerBinding.conversationId]
            : [],
        ),
      },
    ];
  });
}
