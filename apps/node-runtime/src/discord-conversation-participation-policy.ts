import { createConversationParticipationPolicy } from "@lervo/conversation-contract";

import type { DiscordAgentParticipation } from "./discord-agent-participation.js";
import type { NodeDiscordConversationConfig } from "./config-types.js";

export function createDiscordConversationParticipationPolicy(input: {
  config: NodeDiscordConversationConfig;
  projectId: string;
  projectCreatedAt: string;
  agentParticipation: DiscordAgentParticipation;
}) {
  const { config } = input;
  return createConversationParticipationPolicy({
    projectId: input.projectId,
    roleId: input.agentParticipation.roleId,
    conversationIds: config.conversations.map((binding) => binding.conversationId),
    mode: config.policy?.mode ?? (config.routing === undefined ? "mention_only" : "relevant"),
    respondTo: config.policy?.respondTo ?? ["human"],
    signalCodes: config.policy?.signalCodes ?? [],
    cooldownSeconds: config.policy?.cooldownSeconds ?? 0,
    maxResponsesPerHour: config.policy?.maxResponsesPerHour ?? 8,
    maxAutomationDepth: config.policy?.maxAutomationDepth ?? 2,
    createdAt: input.projectCreatedAt,
  });
}
