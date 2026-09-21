import { createConversationParticipationPolicy } from "@lervo/conversation-contract";

import type { DiscordAgentParticipation } from "./discord-agent-participation.js";
import type { NodeDiscordConversationConfig } from "./config-types.js";

export function createDiscordConversationParticipationPolicy(input: {
  config: NodeDiscordConversationConfig;
  projectId: string;
  projectCreatedAt: string;
  agentParticipation: DiscordAgentParticipation;
  hasPeerAgents?: boolean;
}) {
  const { config } = input;
  const respondTo = config.policy?.respondTo ?? ["human"];
  const distributedDiscussion = input.hasPeerAgents === true && config.routing !== undefined;
  return createConversationParticipationPolicy({
    projectId: input.projectId,
    roleId: input.agentParticipation.roleId,
    conversationIds: config.conversations.map((binding) => binding.conversationId),
    mode: config.policy?.mode ?? (config.routing === undefined ? "mention_only" : "relevant"),
    respondTo: distributedDiscussion
      ? [...new Set([...respondTo, "agent" as const, "system" as const])]
      : respondTo,
    unaddressedHumanMessages: config.policy?.unaddressedHumanMessages ?? "evaluate",
    signalCodes: distributedDiscussion
      ? [...new Set([...(config.policy?.signalCodes ?? []), "discussion.deadline"])]
      : (config.policy?.signalCodes ?? []),
    cooldownSeconds: config.policy?.cooldownSeconds ?? 0,
    maxResponsesPerHour:
      config.policy?.maxResponsesPerHour ?? (config.routing === undefined ? 8 : 60),
    maxAutomationDepth: config.policy?.maxAutomationDepth ?? 8,
    createdAt: input.projectCreatedAt,
  });
}
