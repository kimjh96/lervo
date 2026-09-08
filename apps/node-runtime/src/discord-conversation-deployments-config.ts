import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";
import { parseDiscordConversationConfig } from "./discord-conversation-config.js";
import { NodeRuntimeError } from "./errors.js";

const MAX_DISCORD_CONVERSATIONS = 8;

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function validateDistinctIdentities(configs: NodeDiscordConversationConfig[]): void {
  const identitySets = [
    configs.map((config) => config.integrationId),
    configs.map((config) => config.applicationId),
    configs.map((config) => config.botTokenFile),
    configs.map((config) => config.workerId),
    configs.map((config) => config.agentParticipantId),
  ];
  const agentIds = configs.flatMap((config) =>
    config.agentId === undefined ? [] : [config.agentId],
  );
  if (identitySets.some((values) => !unique(values)) || !unique(agentIds)) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Discord conversation deployments must use distinct integration, application, credential, worker, participant, and agent identities.",
    );
  }
  if (configs.length > 1 && configs.some((config) => config.agentId === undefined)) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Every multi-bot Discord deployment must bind one active hired agent.",
    );
  }
  const applicationIds = new Set(configs.map((config) => config.applicationId));
  if (
    configs.some((config) =>
      config.participants.some((participant) => applicationIds.has(participant.userId)),
    )
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Configured Discord bot applications are bound automatically and cannot be repeated as manual participants.",
    );
  }
}

function validateSharedConversationCoordinates(configs: NodeDiscordConversationConfig[]): void {
  const coordinates = new Map<string, string>();
  for (const config of configs) {
    for (const conversation of config.conversations) {
      const external = `${conversation.tenantKey}:${conversation.conversationKey}`;
      const existing = coordinates.get(external);
      if (existing !== undefined && existing !== conversation.conversationId) {
        throw new NodeRuntimeError(
          "invalid_config",
          "Discord bots observing the same external channel must share its Lervo conversation ID.",
        );
      }
      coordinates.set(external, conversation.conversationId);
    }
  }
}

export function parseDiscordConversationDeployments(input: {
  legacy: unknown;
  deployments: unknown;
  baseDirectory: string;
}): {
  discordConversation?: NodeDiscordConversationConfig;
  discordConversations?: NodeDiscordConversationConfig[];
} {
  if (input.legacy !== undefined && input.deployments !== undefined) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Use either discordConversation or discordConversations, not both.",
    );
  }
  if (input.deployments === undefined) {
    return input.legacy === undefined
      ? {}
      : { discordConversation: parseDiscordConversationConfig(input.legacy, input.baseDirectory) };
  }
  if (
    !Array.isArray(input.deployments) ||
    input.deployments.length < 1 ||
    input.deployments.length > MAX_DISCORD_CONVERSATIONS
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      `discordConversations must contain between 1 and ${MAX_DISCORD_CONVERSATIONS} deployments.`,
    );
  }
  const configs = input.deployments.map((deployment) =>
    parseDiscordConversationConfig(deployment, input.baseDirectory),
  );
  validateDistinctIdentities(configs);
  validateSharedConversationCoordinates(configs);
  return { discordConversations: configs };
}

export function configuredDiscordConversations(
  config: Pick<NodeRuntimeConfig, "discordConversation" | "discordConversations">,
): NodeDiscordConversationConfig[] {
  return (
    config.discordConversations ??
    (config.discordConversation === undefined ? [] : [config.discordConversation])
  );
}
