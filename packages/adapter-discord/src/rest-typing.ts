import {
  ConversationPlatformError,
  assertPlatformHttpLimits,
  platformApiUrl,
} from "@lervo/conversation-platform";

import type { DiscordTypingLease, DiscordTypingPort } from "./types.js";

const DEFAULT_API_BASE_URL = "https://discord.com/api/v10";
const DEFAULT_REFRESH_INTERVAL_MS = 8_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;

export interface DiscordRestTypingOptions {
  botToken: string;
  fetch?: typeof globalThis.fetch;
  apiBaseUrl?: string;
  requestTimeoutMs?: number;
  refreshIntervalMs?: number;
  allowInsecureHttpForTests?: boolean;
  onError?(error: ConversationPlatformError): void;
}

export class DiscordRestTyping implements DiscordTypingPort {
  private readonly apiBaseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly refreshIntervalMs: number;

  constructor(private readonly options: DiscordRestTypingOptions) {
    if (
      options.botToken.length < 20 ||
      options.botToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/u.test(options.botToken)
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord bot credential is invalid.",
      );
    }
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/u, "");
    platformApiUrl(this.apiBaseUrl, options.allowInsecureHttpForTests === true);
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    assertPlatformHttpLimits({ requestTimeoutMs: this.requestTimeoutMs });
    if (
      !Number.isSafeInteger(this.refreshIntervalMs) ||
      this.refreshIntervalMs < 1_000 ||
      this.refreshIntervalMs > 9_000
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord typing refresh interval is invalid.",
      );
    }
  }

  start(input: { channelId: string }): DiscordTypingLease {
    if (!/^[0-9]{1,32}$/u.test(input.channelId)) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord typing channel is invalid.",
      );
    }
    let active = true;
    let inFlight = false;
    const pulse = () => {
      if (!active || inFlight) return;
      inFlight = true;
      void this.trigger(input.channelId)
        .catch((error: unknown) => {
          this.options.onError?.(
            error instanceof ConversationPlatformError
              ? error
              : new ConversationPlatformError(
                  "platform_activity_failed",
                  "The Discord typing indicator failed.",
                  { cause: error instanceof Error ? error : undefined },
                ),
          );
        })
        .finally(() => {
          inFlight = false;
        });
    };
    pulse();
    const refresh = setInterval(pulse, this.refreshIntervalMs);
    refresh.unref();
    return {
      stop() {
        active = false;
        clearInterval(refresh);
      },
    };
  }

  private async trigger(channelId: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref();
    try {
      const response = await (this.options.fetch ?? globalThis.fetch)(
        platformApiUrl(
          `${this.apiBaseUrl}/channels/${encodeURIComponent(channelId)}/typing`,
          this.options.allowInsecureHttpForTests === true,
        ),
        {
          method: "POST",
          headers: { authorization: `Bot ${this.options.botToken}` },
          redirect: "error",
          signal: controller.signal,
        },
      );
      await response.body?.cancel();
      if (response.status !== 204) {
        throw new ConversationPlatformError(
          "platform_activity_failed",
          "The Discord API rejected the typing indicator.",
        );
      }
    } catch (error) {
      if (error instanceof ConversationPlatformError) throw error;
      throw new ConversationPlatformError(
        "platform_activity_failed",
        "The Discord typing indicator could not be delivered.",
        { cause: error instanceof Error ? error : undefined },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
