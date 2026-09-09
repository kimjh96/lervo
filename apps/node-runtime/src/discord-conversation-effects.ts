import { DiscordRestAdministration } from "@lervo/adapter-discord";
import type { ManagedConversationSurfaceEffect } from "@lervo/conversation-responder";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import { DiscordConversationAdministrationResponder } from "./discord-platform-action-responder.js";

export function createDiscordConversationEffects(input: {
  config: NodeDiscordConversationConfig;
  botToken: string;
  artifactStore: ArtifactStore;
  fetch?: typeof globalThis.fetch;
}): {
  surfaceEffects: ManagedConversationSurfaceEffect[];
  platformAction: DiscordConversationAdministrationResponder;
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
  ];
  return {
    surfaceEffects,
    platformAction: new DiscordConversationAdministrationResponder({
      artifactStore: input.artifactStore,
      administration: new DiscordRestAdministration({
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
      }),
      conversations: input.config.conversations.map((binding) => ({
        conversationId: binding.conversationId,
        guildId: binding.tenantKey,
        channelId: binding.conversationKey,
      })),
      allowNicknameUpdate: allowedActions.includes("current_member.nickname.set"),
      allowGuildTextChannelCreate: allowedActions.includes("guild_text_channel.create"),
      allowPublicThreadCreate: allowedActions.includes("public_thread.create"),
    }),
  };
}
