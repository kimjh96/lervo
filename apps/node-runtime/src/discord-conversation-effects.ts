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
  const surfaceEffects: ManagedConversationSurfaceEffect[] =
    input.config.administration?.allowedActions.includes("current_member.nickname.set") === true
      ? [
          {
            effectId: "discord_current_member_nickname_set",
            description: "Change this agent's nickname in the current Discord server.",
            argumentDescription: "The intended nickname.",
            maximumArgumentCharacters: 32,
          },
        ]
      : [];
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
      })),
      allowNicknameUpdate: surfaceEffects.length > 0,
    }),
  };
}
