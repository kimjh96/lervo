import {
  ConversationPlatformError,
  assertPlatformHttpLimits,
  getPlatformJson,
  platformApiUrl,
} from "@lervo/conversation-platform";

import type { DiscordManagedBotRolePort } from "./types.js";

const snowflake = /^[0-9]{1,32}$/u;

export interface DiscordRestManagedBotRolesOptions {
  botToken: string;
  allowedGuildIds: readonly string[];
  fetch?: typeof globalThis.fetch;
  apiBaseUrl?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  allowInsecureHttpForTests?: boolean;
}

/** Verifies Discord's managed role-to-bot relation; role labels are never identity evidence. */
export class DiscordRestManagedBotRoles implements DiscordManagedBotRolePort {
  private readonly guilds: ReadonlySet<string>;
  private readonly apiBaseUrl: string;

  constructor(private readonly options: DiscordRestManagedBotRolesOptions) {
    if (
      options.botToken.length < 20 ||
      options.botToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/u.test(options.botToken) ||
      options.allowedGuildIds.length === 0 ||
      new Set(options.allowedGuildIds).size !== options.allowedGuildIds.length ||
      options.allowedGuildIds.some((value) => !snowflake.test(value))
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord managed-role scope is invalid.",
      );
    }
    this.guilds = new Set(options.allowedGuildIds);
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://discord.com/api/v10").replace(/\/$/u, "");
    platformApiUrl(this.apiBaseUrl, options.allowInsecureHttpForTests === true);
    assertPlatformHttpLimits(options);
  }

  async resolve(input: { guildId: string; roleIds: readonly string[] }) {
    if (
      !this.guilds.has(input.guildId) ||
      input.roleIds.length > 32 ||
      input.roleIds.some((roleId) => !snowflake.test(roleId))
    ) {
      throw new ConversationPlatformError(
        "identity_mapping_failed",
        "The Discord managed-role request is outside its verified scope.",
      );
    }
    if (input.roleIds.length === 0) return [];
    let values: unknown;
    try {
      values = await getPlatformJson({
        url: `${this.apiBaseUrl}/guilds/${encodeURIComponent(input.guildId)}/roles`,
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
    } catch (error) {
      throw new ConversationPlatformError(
        "identity_mapping_failed",
        "The Discord managed-role binding could not be verified.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    if (!Array.isArray(values)) {
      throw new ConversationPlatformError(
        "identity_mapping_failed",
        "The Discord role response is invalid.",
      );
    }
    return input.roleIds.flatMap((roleId) => {
      const matching = values.filter(
        (value): value is Record<string, unknown> =>
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value) &&
          (value as Record<string, unknown>).id === roleId,
      );
      if (matching.length !== 1) return [];
      const role = matching[0]!;
      const tags = role.tags;
      if (role.managed !== true || typeof tags !== "object" || tags === null || Array.isArray(tags))
        return [];
      const botId = (tags as Record<string, unknown>).bot_id;
      return typeof botId === "string" && snowflake.test(botId) ? [{ roleId, botId }] : [];
    });
  }
}
