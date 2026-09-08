import {
  ConversationPlatformError,
  assertPlatformHttpLimits,
  patchPlatformJson,
  platformApiUrl,
} from "@lervo/conversation-platform";

import type { DiscordAdministrationPort, DiscordCurrentMemberUpdate } from "./types.js";

export interface DiscordRestAdministrationOptions {
  applicationId: string;
  botToken: string;
  allowedGuildIds: readonly string[];
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
  private readonly now: () => Date;

  constructor(private readonly options: DiscordRestAdministrationOptions) {
    if (
      !/^[0-9]{1,32}$/u.test(options.applicationId) ||
      options.botToken.length < 20 ||
      options.botToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/u.test(options.botToken) ||
      options.allowedGuildIds.length === 0 ||
      options.allowedGuildIds.some((guildId) => !/^[0-9]{1,32}$/u.test(guildId))
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord administration scope or credential is invalid.",
      );
    }
    this.allowedGuildIds = new Set(options.allowedGuildIds);
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
}
