import type { NodeRuntimeConfig } from "./config-types.js";
import { loadNodeBearerToken } from "./credentials.js";
import { loadDiscordBotToken } from "./discord-credentials.js";

export async function preflightNodeRuntimeCredentials(config: NodeRuntimeConfig): Promise<void> {
  await Promise.all([
    loadNodeBearerToken(config.hub.bearerTokenFile),
    config.discordConversation === undefined
      ? Promise.resolve()
      : loadDiscordBotToken(config.discordConversation.botTokenFile).then(() => undefined),
  ]);
}
