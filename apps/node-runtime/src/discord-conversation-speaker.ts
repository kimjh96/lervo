import type { NodeDiscordConversationConfig } from "./config-types.js";

export function discordSpeakerPrincipalId(config: NodeDiscordConversationConfig): string {
  if (config.speaker?.kind === "webhook") {
    return `webhooks:${config.speaker.webhooks
      .map((webhook) => webhook.webhookId)
      .sort()
      .join(",")}`;
  }
  return config.applicationId;
}

export function discordSpeakerParticipantKeys(config: NodeDiscordConversationConfig): string[] {
  if (config.speaker?.kind === "webhook") {
    return config.speaker.webhooks.map((webhook) => `webhook:${webhook.webhookId}`);
  }
  return [`bot:${config.applicationId}`, `user:${config.applicationId}`];
}
