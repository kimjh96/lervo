import {
  ConversationPlatformError,
  assertPlatformHttpLimits,
  deletePlatformResource,
  patchPlatformJson,
  postPlatformJson,
  platformApiUrl,
} from "@lervo/conversation-platform";

import type { DiscordAdministrationPort, DiscordCurrentMemberUpdate } from "./types.js";

export interface DiscordRestAdministrationOptions {
  applicationId: string;
  botToken: string;
  allowedGuildIds: readonly string[];
  allowedChannelIds?: readonly string[];
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  apiBaseUrl?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  allowInsecureHttpForTests?: boolean;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Discord administration response is not an object.");
  }
  return value as Record<string, unknown>;
}

export class DiscordRestAdministration implements DiscordAdministrationPort {
  private readonly apiBaseUrl: string;
  private readonly allowedGuildIds: ReadonlySet<string>;
  private readonly allowedChannelIds: ReadonlySet<string>;
  private readonly now: () => Date;

  constructor(private readonly options: DiscordRestAdministrationOptions) {
    if (
      !/^[0-9]{1,32}$/u.test(options.applicationId) ||
      options.botToken.length < 20 ||
      options.botToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/u.test(options.botToken) ||
      options.allowedGuildIds.length === 0 ||
      options.allowedGuildIds.some((guildId) => !/^[0-9]{1,32}$/u.test(guildId)) ||
      options.allowedChannelIds?.some((channelId) => !/^[0-9]{1,32}$/u.test(channelId)) === true
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord administration scope or credential is invalid.",
      );
    }
    this.allowedGuildIds = new Set(options.allowedGuildIds);
    this.allowedChannelIds = new Set(options.allowedChannelIds ?? []);
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://discord.com/api/v10").replace(/\/$/u, "");
    platformApiUrl(this.apiBaseUrl, options.allowInsecureHttpForTests === true);
    assertPlatformHttpLimits(options);
    this.now = options.now ?? (() => new Date());
  }

  async setCurrentMemberNickname(input: DiscordCurrentMemberUpdate) {
    if (
      !this.allowedGuildIds.has(input.guildId) ||
      (input.nickname !== null &&
        ([...input.nickname].length < 1 ||
          [...input.nickname].length > 32 ||
          input.nickname.includes("\0")))
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord nickname update is outside the configured scope.",
      );
    }
    const response = object(
      await patchPlatformJson({
        url: `${this.apiBaseUrl}/guilds/${encodeURIComponent(input.guildId)}/members/@me`,
        headers: { authorization: `Bot ${this.options.botToken}` },
        body: { nick: input.nickname },
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
    const user = object(response.user);
    if (
      user.id !== this.options.applicationId ||
      !Object.hasOwn(response, "nick") ||
      (response.nick !== null && typeof response.nick !== "string") ||
      response.nick !== input.nickname
    ) {
      throw new ConversationPlatformError(
        "platform_delivery_failed",
        "The Discord nickname update response could not be verified.",
      );
    }
    return {
      guildId: input.guildId,
      applicationId: this.options.applicationId,
      nickname: response.nick,
      observedAt: this.now().toISOString(),
    };
  }

  async createGuildTextChannel(input: {
    guildId: string;
    name: string;
    topic: string | null;
    parentChannelId: string | null;
  }) {
    if (
      !this.allowedGuildIds.has(input.guildId) ||
      !/^[a-z0-9][a-z0-9_-]{0,99}$/u.test(input.name) ||
      (input.topic !== null && ([...input.topic].length > 1_024 || input.topic.includes("\0"))) ||
      (input.parentChannelId !== null && !/^[0-9]{1,32}$/u.test(input.parentChannelId))
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord channel creation request is outside the configured scope.",
      );
    }
    const response = object(
      await postPlatformJson({
        url: `${this.apiBaseUrl}/guilds/${encodeURIComponent(input.guildId)}/channels`,
        headers: { authorization: `Bot ${this.options.botToken}` },
        body: {
          name: input.name,
          type: 0,
          topic: input.topic,
          parent_id: input.parentChannelId,
        },
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
    if (
      typeof response.id !== "string" ||
      !/^[0-9]{1,32}$/u.test(response.id) ||
      response.guild_id !== input.guildId ||
      response.name !== input.name ||
      response.type !== 0 ||
      response.parent_id !== input.parentChannelId
    ) {
      throw new ConversationPlatformError(
        "platform_delivery_failed",
        "The Discord channel creation response could not be verified.",
      );
    }
    return {
      guildId: input.guildId,
      channelId: response.id,
      name: input.name,
      observedAt: this.now().toISOString(),
    };
  }

  async createPublicThread(input: {
    guildId: string;
    channelId: string;
    name: string;
    autoArchiveDuration: 60 | 1440 | 4320 | 10080;
  }) {
    if (
      !this.allowedGuildIds.has(input.guildId) ||
      !this.allowedChannelIds.has(input.channelId) ||
      [...input.name].length < 1 ||
      [...input.name].length > 100 ||
      input.name.includes("\0") ||
      ![60, 1440, 4320, 10080].includes(input.autoArchiveDuration)
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord thread creation request is outside the configured scope.",
      );
    }
    const response = object(
      await postPlatformJson({
        url: `${this.apiBaseUrl}/channels/${encodeURIComponent(input.channelId)}/threads`,
        headers: { authorization: `Bot ${this.options.botToken}` },
        body: {
          name: input.name,
          type: 11,
          auto_archive_duration: input.autoArchiveDuration,
        },
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
    if (
      typeof response.id !== "string" ||
      !/^[0-9]{1,32}$/u.test(response.id) ||
      response.guild_id !== input.guildId ||
      response.parent_id !== input.channelId ||
      response.name !== input.name ||
      response.type !== 11
    ) {
      throw new ConversationPlatformError(
        "platform_delivery_failed",
        "The Discord thread creation response could not be verified.",
      );
    }
    return {
      guildId: input.guildId,
      parentChannelId: input.channelId,
      threadId: response.id,
      name: input.name,
      observedAt: this.now().toISOString(),
    };
  }

  async createIncomingWebhook(input: { guildId: string; channelId: string; name: string }) {
    if (
      !this.allowedGuildIds.has(input.guildId) ||
      !this.allowedChannelIds.has(input.channelId) ||
      [...input.name].length < 1 ||
      [...input.name].length > 80 ||
      input.name.includes("\0")
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord webhook creation request is outside the configured scope.",
      );
    }
    const response = object(
      await postPlatformJson({
        url: `${this.apiBaseUrl}/channels/${encodeURIComponent(input.channelId)}/webhooks`,
        headers: { authorization: `Bot ${this.options.botToken}` },
        body: { name: input.name },
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
    if (
      typeof response.id !== "string" ||
      !/^[0-9]{1,32}$/u.test(response.id) ||
      response.guild_id !== input.guildId ||
      response.channel_id !== input.channelId ||
      response.name !== input.name ||
      typeof response.token !== "string" ||
      response.token.length < 20 ||
      response.token.length > 4_096 ||
      !/^[\x21-\x7e]+$/u.test(response.token)
    ) {
      throw new ConversationPlatformError(
        "platform_delivery_failed",
        "The Discord webhook creation response could not be verified.",
      );
    }
    return {
      guildId: input.guildId,
      channelId: input.channelId,
      webhookId: response.id,
      name: input.name,
      token: response.token,
      observedAt: this.now().toISOString(),
    };
  }

  async updateIncomingWebhook(input: {
    guildId: string;
    channelId: string;
    webhookId: string;
    name: string;
  }) {
    if (
      !this.allowedGuildIds.has(input.guildId) ||
      !this.allowedChannelIds.has(input.channelId) ||
      !/^[0-9]{1,32}$/u.test(input.webhookId) ||
      [...input.name].length < 1 ||
      [...input.name].length > 80 ||
      input.name.includes("\0")
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord webhook update request is outside the configured scope.",
      );
    }
    const response = object(
      await patchPlatformJson({
        url: `${this.apiBaseUrl}/webhooks/${encodeURIComponent(input.webhookId)}`,
        headers: { authorization: `Bot ${this.options.botToken}` },
        body: { name: input.name },
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
    if (
      response.id !== input.webhookId ||
      response.guild_id !== input.guildId ||
      response.channel_id !== input.channelId ||
      response.name !== input.name ||
      response.type !== 1
    ) {
      throw new ConversationPlatformError(
        "platform_delivery_failed",
        "The Discord webhook update response could not be verified.",
      );
    }
    return {
      guildId: input.guildId,
      channelId: input.channelId,
      webhookId: input.webhookId,
      name: input.name,
      observedAt: this.now().toISOString(),
    };
  }

  async deleteIncomingWebhook(input: { guildId: string; channelId: string; webhookId: string }) {
    if (
      !this.allowedGuildIds.has(input.guildId) ||
      !this.allowedChannelIds.has(input.channelId) ||
      !/^[0-9]{1,32}$/u.test(input.webhookId)
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord webhook deletion request is outside the configured scope.",
      );
    }
    await deletePlatformResource({
      url: `${this.apiBaseUrl}/webhooks/${encodeURIComponent(input.webhookId)}`,
      headers: { authorization: `Bot ${this.options.botToken}` },
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
      ...(this.options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: this.options.requestTimeoutMs }),
      ...(this.options.maxResponseBytes === undefined
        ? {}
        : { maxResponseBytes: this.options.maxResponseBytes }),
      allowInsecureHttpForTests: this.options.allowInsecureHttpForTests === true,
    });
    return { ...input, observedAt: this.now().toISOString() };
  }
}
