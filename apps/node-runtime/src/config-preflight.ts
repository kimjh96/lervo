import type { NodeRuntimeConfig } from "./config-types.js";
import { loadNodeBearerToken } from "./credentials.js";
import { loadDiscordBotToken } from "./discord-credentials.js";
import { configuredDiscordConversations } from "./discord-conversation-deployments-config.js";

export async function preflightNodeRuntimeCredentials(config: NodeRuntimeConfig): Promise<void> {
  await Promise.all([
    loadNodeBearerToken(config.hub.bearerTokenFile),
    ...configuredDiscordConversations(config).map((conversation) =>
      loadDiscordBotToken(conversation.botTokenFile).then(() => undefined),
    ),
    ...configuredDiscordConversations(config).flatMap((conversation) =>
      conversation.speaker?.kind === "webhook"
        ? conversation.speaker.webhooks.map((webhook) =>
            loadDiscordBotToken(webhook.tokenFile).then(() => undefined),
          )
        : [],
    ),
  ]);
}
