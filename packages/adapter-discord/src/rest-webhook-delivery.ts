import { createHash } from "node:crypto";

import {
  ConversationPlatformError,
  PlatformDeliveryRejectedError,
  assertPlatformHttpLimits,
  deliverPlatformMessageWithReplay,
  platformApiUrl,
  postPlatformJson,
  type ConversationPlatformDeliveryReplayPort,
} from "@lervo/conversation-platform";

import type {
  DiscordDeliveryPort,
  DiscordDeliveryRequest,
  DiscordDeliveryResult,
} from "./types.js";
import { webhookCanPublish } from "./webhook-publication.js";

export interface DiscordRestWebhookDeliveryOptions {
  integrationId: string;
  webhookId: string;
  webhookToken: string;
  parentChannelId: string;
  username: string;
  avatarUrl?: string;
  replay: ConversationPlatformDeliveryReplayPort;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  apiBaseUrl?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  allowInsecureHttpForTests?: boolean;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Discord webhook response is not an object");
  }
  return value as Record<string, unknown>;
}

export class DiscordRestWebhookDelivery implements DiscordDeliveryPort {
  private readonly now: () => Date;
  private readonly apiBaseUrl: string;

  constructor(private readonly options: DiscordRestWebhookDeliveryOptions) {
    if (
      !/^itg_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(options.integrationId) ||
      !/^[0-9]{1,32}$/u.test(options.webhookId) ||
      !/^[0-9]{1,32}$/u.test(options.parentChannelId) ||
      options.webhookToken.length < 20 ||
      options.webhookToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/u.test(options.webhookToken) ||
      [...options.username].length < 1 ||
      [...options.username].length > 80 ||
      options.username.includes("\0")
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord webhook delivery configuration is invalid.",
      );
    }
    if (options.avatarUrl !== undefined) {
      let avatar: URL;
      try {
        avatar = new URL(options.avatarUrl);
      } catch (error) {
        throw new ConversationPlatformError(
          "invalid_platform_configuration",
          "The Discord webhook avatar URL is invalid.",
          { cause: error },
        );
      }
      if (avatar.protocol !== "https:" || avatar.username || avatar.password) {
        throw new ConversationPlatformError(
          "invalid_platform_configuration",
          "The Discord webhook avatar URL must be an HTTPS URL without credentials.",
        );
      }
    }
    this.now = options.now ?? (() => new Date());
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://discord.com/api/v10").replace(/\/$/u, "");
    platformApiUrl(this.apiBaseUrl, options.allowInsecureHttpForTests === true);
    assertPlatformHttpLimits(options);
  }

  async send(input: DiscordDeliveryRequest): Promise<DiscordDeliveryResult> {
    if (
      !webhookCanPublish(input) ||
      input.guildId === null ||
      [...input.content].length > 2_000 ||
      input.channelId !== this.options.parentChannelId ||
      (input.threadId !== null && !/^[0-9]{1,32}$/u.test(input.threadId)) ||
      (input.replyToMessageId !== null && !/^[0-9]{1,32}$/u.test(input.replyToMessageId))
    ) {
      throw new ConversationPlatformError(
        "platform_delivery_failed",
        "The Discord webhook target or content is invalid.",
      );
    }
    const body = {
      content: input.content,
      username: this.options.username,
      ...(this.options.avatarUrl === undefined ? {} : { avatar_url: this.options.avatarUrl }),
      allowed_mentions: { parse: [], replied_user: false },
    };
    const requestHash = `sha256:${createHash("sha256")
      .update(
        JSON.stringify({
          guildId: input.guildId,
          channelId: input.channelId,
          threadId: input.threadId,
          replyToMessageId: input.replyToMessageId,
          webhookId: this.options.webhookId,
          body,
        }),
      )
      .digest("hex")}`;
    const query = new URLSearchParams({ wait: "true" });
    if (input.threadId !== null) query.set("thread_id", input.threadId);
    const nativeFetch = this.options.fetch ?? globalThis.fetch;
    const redactingFetch: typeof globalThis.fetch = async (...arguments_) => {
      try {
        return await nativeFetch(...arguments_);
      } catch (error) {
        throw new Error("Discord webhook transport failed.", { cause: error });
      }
    };
    const result = await deliverPlatformMessageWithReplay({
      platform: "discord",
      integrationId: this.options.integrationId,
      outboundId: input.outboundId,
      requestHash,
      attemptedAt: this.now().toISOString(),
      replay: this.options.replay,
      unknownMessage:
        "The Discord webhook delivery result is unknown, so the message was not resent. Operator review is required.",
      conflictMessage: "A different request is bound to the same Discord outbound ID.",
      rejectedMessage: "The Discord API rejected webhook message delivery.",
      failureMessage: "The Discord webhook delivery result could not be verified safely.",
      send: async () => {
        let nativeResponse: unknown;
        try {
          nativeResponse = await postPlatformJson({
            url: `${this.apiBaseUrl}/webhooks/${encodeURIComponent(this.options.webhookId)}/${encodeURIComponent(this.options.webhookToken)}?${query.toString()}`,
            headers: {},
            body,
            fetch: redactingFetch,
            ...(this.options.requestTimeoutMs === undefined
              ? {}
              : { requestTimeoutMs: this.options.requestTimeoutMs }),
            ...(this.options.maxResponseBytes === undefined
              ? {}
              : { maxResponseBytes: this.options.maxResponseBytes }),
            allowInsecureHttpForTests: this.options.allowInsecureHttpForTests === true,
            allowQuery: true,
          });
        } catch (error) {
          if (error instanceof PlatformDeliveryRejectedError) throw error;
          throw new Error("Discord webhook request failed without a verified response.", {
            cause: error,
          });
        }
        const response = object(nativeResponse);
        if (
          typeof response.id !== "string" ||
          !/^[0-9]{1,32}$/u.test(response.id) ||
          response.channel_id !== (input.threadId ?? input.channelId) ||
          response.webhook_id !== this.options.webhookId
        ) {
          throw new Error("Discord webhook delivery response mismatch");
        }
        return {
          externalMessageKey: response.id,
          deliveredAt: this.now().toISOString(),
        };
      },
    });
    return { messageId: result.externalMessageKey, deliveredAt: result.deliveredAt };
  }
}
