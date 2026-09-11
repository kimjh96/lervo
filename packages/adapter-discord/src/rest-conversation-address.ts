import {
  ConversationPlatformError,
  assertPlatformHttpLimits,
  getPlatformJson,
  platformApiUrl,
} from "@lervo/conversation-platform";

import type { DiscordConversationAddressPort } from "./types.js";

export interface DiscordRestConversationAddressOptions {
  botToken: string;
  allowedGuildIds: readonly string[];
  parentChannelIds: readonly string[];
  fetch?: typeof globalThis.fetch;
  apiBaseUrl?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  allowInsecureHttpForTests?: boolean;
}

const discordThreadTypes = new Set([10, 11, 12]);
const snowflake = /^[0-9]{1,32}$/u;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Discord channel response is not an object");
  }
  return value as Record<string, unknown>;
}

/** Resolves a Discord thread channel to the configured parent conversation. */
export class DiscordRestConversationAddress implements DiscordConversationAddressPort {
  private readonly guilds: ReadonlySet<string>;
  private readonly parents: ReadonlySet<string>;
  private readonly apiBaseUrl: string;

  constructor(private readonly options: DiscordRestConversationAddressOptions) {
    if (
      options.botToken.length < 20 ||
      options.botToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/u.test(options.botToken) ||
      options.allowedGuildIds.length === 0 ||
      new Set(options.allowedGuildIds).size !== options.allowedGuildIds.length ||
      options.allowedGuildIds.some((value) => !snowflake.test(value)) ||
      options.parentChannelIds.length === 0 ||
      new Set(options.parentChannelIds).size !== options.parentChannelIds.length ||
      options.parentChannelIds.some((value) => !snowflake.test(value))
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord conversation address scope is invalid.",
      );
    }
    this.guilds = new Set(options.allowedGuildIds);
    this.parents = new Set(options.parentChannelIds);
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://discord.com/api/v10").replace(/\/$/u, "");
    platformApiUrl(this.apiBaseUrl, options.allowInsecureHttpForTests === true);
    assertPlatformHttpLimits(options);
  }

  async resolve(input: {
    guildId: string | null;
    channelId: string;
  }): Promise<{ conversationKey: string; threadKey: string | null } | null> {
    if (!snowflake.test(input.channelId)) {
      throw new ConversationPlatformError(
        "identity_mapping_failed",
        "The Discord conversation channel is invalid.",
      );
    }
    if (input.guildId === null) {
      return { conversationKey: input.channelId, threadKey: null };
    }
    if (!this.guilds.has(input.guildId)) {
      throw new ConversationPlatformError(
        "platform_authentication_failed",
        "The Discord conversation guild is outside the configured scope.",
      );
    }
    if (this.parents.has(input.channelId)) {
      return { conversationKey: input.channelId, threadKey: null };
    }

    let channel: Record<string, unknown>;
    try {
      channel = object(
        await getPlatformJson({
          url: `${this.apiBaseUrl}/channels/${encodeURIComponent(input.channelId)}`,
          headers: { authorization: `Bot ${this.options.botToken}` },
          ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
          ...(this.options.requestTimeoutMs === undefined
            ? {}
            : { requestTimeoutMs: this.options.requestTimeoutMs }),
          ...(this.options.maxResponseBytes === undefined
            ? {}
            : { maxResponseBytes: this.options.maxResponseBytes }),
          allowInsecureHttpForTests: this.options.allowInsecureHttpForTests === true,
        }),
      );
    } catch (error) {
      throw new ConversationPlatformError(
        "identity_mapping_failed",
        "The Discord thread address could not be verified.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    if (
      channel.id !== input.channelId ||
      channel.guild_id !== input.guildId ||
      typeof channel.parent_id !== "string" ||
      !this.parents.has(channel.parent_id) ||
      typeof channel.type !== "number" ||
      !discordThreadTypes.has(channel.type)
    ) {
      return null;
    }
    return { conversationKey: channel.parent_id, threadKey: input.channelId };
  }
}
