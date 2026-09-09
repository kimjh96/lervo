import { resolve } from "node:path";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import { configRecord, configText, exactConfigKeys } from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";

const SNOWFLAKE = /^[0-9]{1,32}$/u;

export function parseDiscordConversationSpeaker(
  value: unknown,
  baseDirectory: string,
  conversationChannelIds: readonly string[],
): NodeDiscordConversationConfig["speaker"] {
  if (value === undefined) return undefined;
  const source = configRecord(value, "discordConversation.speaker");
  const kind = configText(source.kind, "discordConversation.speaker.kind");
  if (kind === "bot") {
    exactConfigKeys(source, ["kind"], "discordConversation.speaker");
    return { kind };
  }
  if (kind !== "webhook") {
    throw new NodeRuntimeError("invalid_config", "The Discord speaker kind is invalid.");
  }
  exactConfigKeys(source, ["kind", "webhooks", "avatarUrl"], "discordConversation.speaker");
  if (
    !Array.isArray(source.webhooks) ||
    source.webhooks.length < 1 ||
    source.webhooks.length > 64
  ) {
    throw new NodeRuntimeError("invalid_config", "The Discord speaker webhooks are invalid.");
  }
  const webhooks = source.webhooks.map((value, index) => {
    const binding = configRecord(value, `discordConversation.speaker.webhooks[${index}]`);
    exactConfigKeys(
      binding,
      ["channelId", "webhookId", "tokenFile"],
      `discordConversation.speaker.webhooks[${index}]`,
    );
    const channelId = configText(binding.channelId, "Discord webhook channelId");
    const webhookId = configText(binding.webhookId, "Discord webhook webhookId");
    if (!SNOWFLAKE.test(channelId) || !SNOWFLAKE.test(webhookId)) {
      throw new NodeRuntimeError(
        "invalid_config",
        "The Discord speaker webhook identity is invalid.",
      );
    }
    return {
      channelId,
      webhookId,
      tokenFile: resolve(baseDirectory, configText(binding.tokenFile, "Discord webhook tokenFile")),
    };
  });
  const configuredChannels = new Set(conversationChannelIds);
  if (
    new Set(webhooks.map((webhook) => webhook.channelId)).size !== webhooks.length ||
    new Set(webhooks.map((webhook) => webhook.webhookId)).size !== webhooks.length ||
    new Set(webhooks.map((webhook) => webhook.tokenFile)).size !== webhooks.length ||
    webhooks.some((webhook) => !configuredChannels.has(webhook.channelId)) ||
    conversationChannelIds.some(
      (channelId) => !webhooks.some((webhook) => webhook.channelId === channelId),
    )
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Each configured Discord conversation requires one distinct speaker webhook.",
    );
  }
  const avatarUrl =
    source.avatarUrl === undefined
      ? undefined
      : configText(source.avatarUrl, "discordConversation.speaker.avatarUrl");
  if (avatarUrl !== undefined) {
    let avatar: URL;
    try {
      avatar = new URL(avatarUrl);
    } catch (error) {
      throw new NodeRuntimeError("invalid_config", "The Discord speaker avatar URL is invalid.", {
        cause: error,
      });
    }
    if (avatar.protocol !== "https:" || avatar.username || avatar.password) {
      throw new NodeRuntimeError(
        "invalid_config",
        "The Discord speaker avatar URL must be an HTTPS URL without credentials.",
      );
    }
  }
  return {
    kind,
    webhooks,
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
  };
}
