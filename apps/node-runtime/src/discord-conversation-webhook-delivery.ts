import type { DiscordConversationDeployment } from "@lervo/conversation-app";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import { loadDiscordBotToken } from "./discord-credentials.js";
import { NodeRuntimeError } from "./errors.js";

export async function loadDiscordConversationDeliveryCredentials(input: {
  config: NodeDiscordConversationConfig;
  agentDisplayName: string | null;
}): Promise<{
  botToken: string;
  delivery: DiscordConversationDeployment["delivery"] | undefined;
}> {
  const botToken = await loadDiscordBotToken(input.config.botTokenFile);
  if (input.config.speaker?.kind !== "webhook") {
    return { botToken, delivery: undefined };
  }
  if (input.agentDisplayName === null) {
    throw new NodeRuntimeError(
      "invalid_config",
      "A Discord webhook speaker requires a hired-agent display name.",
    );
  }
  return {
    botToken,
    delivery: {
      kind: "webhook",
      username: input.agentDisplayName,
      webhooks: await Promise.all(
        input.config.speaker.webhooks.map(async (webhook) => ({
          webhookId: webhook.webhookId,
          webhookToken: await loadDiscordBotToken(webhook.tokenFile),
          parentChannelId: webhook.channelId,
        })),
      ),
      ...(input.config.speaker.avatarUrl === undefined
        ? {}
        : { avatarUrl: input.config.speaker.avatarUrl }),
    },
  };
}
