import { createHash } from "node:crypto";

import {
  ConversationPlatformError,
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
import { createDiscordMessageNonce } from "./message-nonce.js";

export interface DiscordRestDeliveryOptions {
  integrationId: string;
  botToken: string;
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
    throw new Error("Discord response is not an object");
  }
  return value as Record<string, unknown>;
}

export class DiscordRestDelivery implements DiscordDeliveryPort {
  private readonly now: () => Date;
  private readonly apiBaseUrl: string;

  constructor(private readonly options: DiscordRestDeliveryOptions) {
    if (
      !/^itg_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(options.integrationId) ||
      options.botToken.length < 20 ||
      options.botToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/.test(options.botToken)
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord integration or bot credential is invalid.",
      );
    }
    this.now = options.now ?? (() => new Date());
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://discord.com/api/v10").replace(/\/$/, "");
    platformApiUrl(this.apiBaseUrl, options.allowInsecureHttpForTests === true);
    assertPlatformHttpLimits(options);
  }

  async send(input: DiscordDeliveryRequest): Promise<DiscordDeliveryResult> {
    if (
      !/^[0-9]{1,32}$/u.test(input.channelId) ||
      (input.threadId !== null && !/^[0-9]{1,32}$/u.test(input.threadId)) ||
      (input.replyToMessageId !== null && !/^[0-9]{1,32}$/u.test(input.replyToMessageId)) ||
      [...input.content].length > 2_000
    ) {
      throw new ConversationPlatformError(
        "platform_delivery_failed",
        "The Discord channel or content is invalid.",
      );
    }
    const targetChannelId = input.threadId ?? input.channelId;
    const nonce = createDiscordMessageNonce(
      input.outboundId,
      input.audienceParticipation,
      input.coordination,
    );
    const body = {
      content: input.content,
      nonce,
      enforce_nonce: true,
      allowed_mentions: { parse: [], replied_user: false },
      ...(input.replyToMessageId === null
        ? {}
        : {
            message_reference: { message_id: input.replyToMessageId, fail_if_not_exists: false },
          }),
    };
    const requestHash = `sha256:${createHash("sha256")
      .update(
        JSON.stringify({
          guildId: input.guildId,
          channelId: input.channelId,
          threadId: input.threadId,
          body,
        }),
      )
      .digest("hex")}`;
    const result = await deliverPlatformMessageWithReplay({
      platform: "discord",
      integrationId: this.options.integrationId,
      outboundId: input.outboundId,
      requestHash,
      attemptedAt: this.now().toISOString(),
      replay: this.options.replay,
      unknownMessage:
        "The Discord delivery result is unknown, so the message was not resent. Operator review is required.",
      conflictMessage: "A different request is bound to the same Discord outbound ID.",
      rejectedMessage: "The Discord API rejected message delivery.",
      failureMessage: "The Discord delivery result could not be verified safely.",
      send: async () => {
        const response = object(
          await postPlatformJson({
            url: `${this.apiBaseUrl}/channels/${encodeURIComponent(targetChannelId)}/messages`,
            headers: { authorization: `Bot ${this.options.botToken}` },
            body,
            ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
            ...(this.options.requestTimeoutMs === undefined
              ? {}
              : {
                  requestTimeoutMs: this.options.requestTimeoutMs,
                }),
            ...(this.options.maxResponseBytes === undefined
              ? {}
              : {
                  maxResponseBytes: this.options.maxResponseBytes,
                }),
            allowInsecureHttpForTests: this.options.allowInsecureHttpForTests === true,
          }),
        );
        if (
          typeof response.id !== "string" ||
          !/^[0-9]{1,32}$/.test(response.id) ||
          response.channel_id !== targetChannelId ||
          response.content !== input.content ||
          (response.nonce !== undefined && response.nonce !== nonce) ||
          (input.replyToMessageId !== null &&
            object(response.message_reference).message_id !== input.replyToMessageId)
        ) {
          throw new Error("Discord delivery response mismatch");
        }
        const deliveredAt = this.now().toISOString();
        return { externalMessageKey: response.id, deliveredAt };
      },
    });
    return { messageId: result.externalMessageKey, deliveredAt: result.deliveredAt };
  }
}
