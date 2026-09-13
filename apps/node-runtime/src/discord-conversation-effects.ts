import { DiscordRestAdministration } from "@lervo/adapter-discord";
import type { ManagedConversationSurfaceEffect } from "@lervo/conversation-responder";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";
import { ConversationPlatformActionRouter } from "./conversation-platform-action-router.js";
import {
  ConversationWorkforceActionResponder,
  RepositoryConversationWorkforceHiring,
} from "./conversation-workforce-action-responder.js";
import { DiscordConversationAdministrationResponder } from "./discord-platform-action-responder.js";
import type { SQLiteConversationRepositoryWorkStore } from "./conversation-repository-work-store.js";
import { RepositoryDiscordAgentOrganizationDeployment } from "./discord-agent-organization-deployment.js";
import { DiscordHiredAgentDeployment } from "./discord-hired-agent-deployment.js";
import { discordWorkforceExecution } from "./discord-workforce-execution.js";

export function createDiscordConversationEffects(input: {
  config: NodeDiscordConversationConfig;
  botToken: string;
  artifactStore: ArtifactStore;
  repositoryRoot: string;
  parentAgentId: string | null;
  parentRoleId: string;
  repositoryWorkStore?: SQLiteConversationRepositoryWorkStore;
  runtimeConfigPath?: string;
  onDeploymentPrepared?(sourceEventId: string): void;
  fetch?: typeof globalThis.fetch;
}): {
  surfaceEffects: ManagedConversationSurfaceEffect[];
  platformAction: DiscordPlatformActionResponder;
} {
  const allowedActions = input.config.administration?.allowedActions ?? [];
  const surfaceEffects: ManagedConversationSurfaceEffect[] = [
    ...(allowedActions.includes("current_member.nickname.set")
      ? [
          {
            effectId: "discord_current_member_nickname_set",
            description: "Change this agent's nickname in the current Discord server.",
            argumentDescription: "The intended nickname.",
            maximumArgumentCharacters: 32,
          },
        ]
      : []),
    ...(allowedActions.includes("guild_text_channel.create")
      ? [
          {
            effectId: "discord_guild_text_channel_create",
            description: "Create a text channel in the current Discord server.",
            argumentDescription:
              "The lowercase Discord channel name using letters, numbers, hyphens, or underscores.",
            maximumArgumentCharacters: 100,
          },
        ]
      : []),
    ...(allowedActions.includes("public_thread.create")
      ? [
          {
            effectId: "discord_public_thread_create",
            description: "Create a public thread under the current Discord channel.",
            argumentDescription: "The intended thread name.",
            maximumArgumentCharacters: 100,
          },
        ]
      : []),
    ...(allowedActions.includes("workforce.agent.hire")
      ? [
          {
            effectId: "workforce_agent_hire",
            description:
              "Hire one child agent in this product owner's repository with inherited capability limits.",
            argumentDescription:
              "Compact JSON with exactly name, roleId, and provider (codex, claude, or any).",
            maximumArgumentCharacters: 512,
          },
        ]
      : []),
  ];
  const administration = new DiscordRestAdministration({
    applicationId: input.config.applicationId,
    botToken: input.botToken,
    allowedGuildIds: input.config.allowedGuildIds,
    allowedChannelIds: input.config.conversations.map((item) => item.conversationKey),
    ...(input.config.http?.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: input.config.http.requestTimeoutMs }),
    ...(input.config.http?.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: input.config.http.maxResponseBytes }),
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
  const discord = new DiscordConversationAdministrationResponder({
    artifactStore: input.artifactStore,
    administration,
    conversations: input.config.conversations.map((binding) => ({
      conversationId: binding.conversationId,
      guildId: binding.tenantKey,
      channelId: binding.conversationKey,
    })),
    allowNicknameUpdate: allowedActions.includes("current_member.nickname.set"),
    allowGuildTextChannelCreate: allowedActions.includes("guild_text_channel.create"),
    allowPublicThreadCreate: allowedActions.includes("public_thread.create"),
  });
  const workforce = allowedActions.includes("workforce.agent.hire")
    ? new ConversationWorkforceActionResponder({
        artifactStore: input.artifactStore,
        parentAgentId: input.parentAgentId!,
        parentRoleId: input.parentRoleId,
        hiring: new RepositoryConversationWorkforceHiring(input.repositoryRoot),
        ...(discordWorkforceExecution(input.config, input.runtimeConfigPath) !==
        "separate_deployment"
          ? {}
          : {
              deployment: new DiscordHiredAgentDeployment({
                configPath: input.runtimeConfigPath!,
                parentIntegrationId: input.config.integrationId,
                administration,
                organization: new RepositoryDiscordAgentOrganizationDeployment(
                  input.repositoryRoot,
                ),
              }),
            }),
        ...(input.onDeploymentPrepared === undefined
          ? {}
          : { onDeploymentPrepared: input.onDeploymentPrepared }),
        ...(input.repositoryWorkStore === undefined
          ? {}
          : {
              onConversationDelegateHired: ({ conversationId, threadId, agent, hiredAt }) =>
                input.repositoryWorkStore!.activateDelegate({
                  conversationId,
                  threadId,
                  delegate: {
                    agentId: agent.agentId,
                    displayName: agent.displayName,
                    roleId: agent.roleId,
                    provider: agent.provider,
                  },
                  activatedAt: hiredAt,
                }),
            }),
      })
    : undefined;
  return {
    surfaceEffects,
    platformAction: new ConversationPlatformActionRouter(discord, workforce),
  };
}
