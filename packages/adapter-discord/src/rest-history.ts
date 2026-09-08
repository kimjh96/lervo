import {
  ConversationPlatformError,
  assertPlatformHttpLimits,
  getPlatformJson,
  platformApiUrl,
} from "@lervo/conversation-platform";

import type { DiscordHistoryMessage, DiscordHistoryPort } from "./types.js";

export interface DiscordRestHistoryOptions {
  botToken: string;
  fetch?: typeof globalThis.fetch;
  apiBaseUrl?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  allowInsecureHttpForTests?: boolean;
}

export class DiscordRestHistory implements DiscordHistoryPort {
  private readonly apiBaseUrl: string;

  constructor(private readonly options: DiscordRestHistoryOptions) {
    if (
      options.botToken.length < 20 ||
      options.botToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/.test(options.botToken)
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord bot credential is invalid.",
      );
    }
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://discord.com/api/v10").replace(/\/$/, "");
    platformApiUrl(this.apiBaseUrl, options.allowInsecureHttpForTests === true);
    assertPlatformHttpLimits(options);
  }

  async list(input: {
    channelId: string;
    after: string | null;
    limit: number;
  }): Promise<readonly DiscordHistoryMessage[]> {
    if (
      !/^[0-9]{1,32}$/.test(input.channelId) ||
      (input.after !== null && !/^[0-9]{1,32}$/.test(input.after)) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord history channel, cursor, or page limit is invalid.",
      );
    }
    const query = new URLSearchParams({ limit: String(input.limit) });
    if (input.after !== null) query.set("after", input.after);
    const result = await getPlatformJson({
      url: `${this.apiBaseUrl}/channels/${encodeURIComponent(input.channelId)}/messages?${query}`,
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
    if (!Array.isArray(result)) {
      throw new ConversationPlatformError(
        "platform_ingress_failed",
        "The Discord history response is not a message collection.",
      );
    }
    return result.map((message) => {
      if (
        typeof message !== "object" ||
        message === null ||
        Array.isArray(message) ||
        typeof (message as { id?: unknown }).id !== "string" ||
        !/^[0-9]{1,32}$/.test((message as { id: string }).id)
      ) {
        throw new ConversationPlatformError(
          "platform_ingress_failed",
          "The Discord history response contains an invalid message identity.",
        );
      }
      return {
        messageId: (message as { id: string }).id,
        body: Buffer.from(JSON.stringify(message)),
      };
    });
  }
}
