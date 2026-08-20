import { createHash } from "node:crypto";

import {
  ConversationPlatformError,
  assertPlatformHttpLimits,
  deliverPlatformMessageWithReplay,
  platformApiUrl,
  postPlatformJson,
  type ConversationPlatformDeliveryReplayPort,
} from "@lervo/conversation-platform";

import type { DiscordDeliveryPort, DiscordDeliveryRequest, DiscordDeliveryResult } from "./types.js";

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
    if (!/^itg_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(options.integrationId) ||
      options.botToken.length < 20 || options.botToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/.test(options.botToken)) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "Discord integration 또는 bot credential이 유효하지 않습니다.",
      );
    }
    this.now = options.now ?? (() => new Date());
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://discord.com/api/v10").replace(/\/$/, "");
    platformApiUrl(this.apiBaseUrl, options.allowInsecureHttpForTests === true);
    assertPlatformHttpLimits(options);
  }

  async send(input: DiscordDeliveryRequest): Promise<DiscordDeliveryResult> {
    if (!/^[0-9]{1,32}$/.test(input.channelId) || [...input.content].length > 2_000) {
      throw new ConversationPlatformError("platform_delivery_failed", "Discord channel 또는 content가 유효하지 않습니다.");
    }
    const nonce = createHash("sha256").update(input.outboundId).digest("base64url").slice(0, 25);
    const body = {
      content: input.content,
      nonce,
      enforce_nonce: true,
      allowed_mentions: { parse: [], replied_user: false },
      ...(input.replyToMessageId === null ? {} : {
        message_reference: { message_id: input.replyToMessageId, fail_if_not_exists: false },
      }),
    };
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({
      guildId: input.guildId,
      channelId: input.channelId,
      body,
    })).digest("hex")}`;
    const result = await deliverPlatformMessageWithReplay({
      platform: "discord",
      integrationId: this.options.integrationId,
      outboundId: input.outboundId,
      requestHash,
      attemptedAt: this.now().toISOString(),
      replay: this.options.replay,
      unknownMessage: "Discord 전송 결과를 확인할 수 없어 재발송하지 않았습니다. 운영자 확인이 필요합니다.",
      conflictMessage: "같은 Discord outbound ID에 다른 요청이 연결되어 있습니다.",
      rejectedMessage: "Discord API가 메시지 전송을 거부했습니다.",
      failureMessage: "Discord 전송 결과를 안전하게 확인하지 못했습니다.",
      send: async () => {
        const response = object(await postPlatformJson({
          url: `${this.apiBaseUrl}/channels/${encodeURIComponent(input.channelId)}/messages`,
          headers: { authorization: `Bot ${this.options.botToken}` },
          body,
          ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
          ...(this.options.requestTimeoutMs === undefined ? {} : {
            requestTimeoutMs: this.options.requestTimeoutMs,
          }),
          ...(this.options.maxResponseBytes === undefined ? {} : {
            maxResponseBytes: this.options.maxResponseBytes,
          }),
          allowInsecureHttpForTests: this.options.allowInsecureHttpForTests === true,
        }));
        if (typeof response.id !== "string" || !/^[0-9]{1,32}$/.test(response.id) ||
          response.channel_id !== input.channelId) {
          throw new Error("Discord delivery response mismatch");
        }
        const deliveredAt = this.now().toISOString();
        return { externalMessageKey: response.id, deliveredAt };
      },
    });
    return { messageId: result.externalMessageKey, deliveredAt: result.deliveredAt };
  }
}
