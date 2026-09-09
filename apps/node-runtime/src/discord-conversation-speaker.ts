import type { NodeDiscordConversationConfig } from "./config-types.js";

type DiscordSpeakerConfig = Pick<NodeDiscordConversationConfig, "applicationId" | "speaker">;

export function discordSpeakerPrincipalId(config: DiscordSpeakerConfig): string {
  if (config.speaker?.kind === "webhook") {
    return `webhooks:${config.speaker.webhooks
      .map((webhook) => webhook.webhookId)
      .sort()
      .join(",")}`;
  }
  return config.applicationId;
}

export function discordSpeakerParticipantKeys(config: DiscordSpeakerConfig): string[] {
  if (config.speaker?.kind === "webhook") {
    return config.speaker.webhooks.map((webhook) => `webhook:${webhook.webhookId}`);
  }
  return [`bot:${config.applicationId}`, `user:${config.applicationId}`];
}
