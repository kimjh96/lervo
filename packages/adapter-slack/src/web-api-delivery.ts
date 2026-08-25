import { createHash } from "node:crypto";

import {
  ConversationPlatformError,
  assertPlatformHttpLimits,
  deliverPlatformMessageWithReplay,
  PlatformDeliveryRejectedError,
  platformApiUrl,
  postPlatformJson,
  type ConversationPlatformDeliveryReplayPort,
} from "@lervo/conversation-platform";

import type { SlackDeliveryPort, SlackDeliveryRequest, SlackDeliveryResult } from "./types.js";

export interface SlackWebApiDeliveryOptions {
  integrationId: string;
  botToken: string;
  replay: ConversationPlatformDeliveryReplayPort;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  apiUrl?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  allowInsecureHttpForTests?: boolean;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Slack response is not an object");
  }
  return value as Record<string, unknown>;
}

function plainText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export class SlackWebApiDelivery implements SlackDeliveryPort {
  private readonly now: () => Date;
  private readonly apiUrl: string;

  constructor(private readonly options: SlackWebApiDeliveryOptions) {
    if (
      !/^itg_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(options.integrationId) ||
      options.botToken.length < 20 ||
      options.botToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/.test(options.botToken)
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Slack integration or bot credential is invalid.",
      );
    }
    this.now = options.now ?? (() => new Date());
    this.apiUrl = options.apiUrl ?? "https://slack.com/api/chat.postMessage";
    platformApiUrl(this.apiUrl, options.allowInsecureHttpForTests === true);
    assertPlatformHttpLimits(options);
  }

  async send(input: SlackDeliveryRequest): Promise<SlackDeliveryResult> {
    const threadTs = input.replyToTs ?? input.threadTs;
    if (input.replyToTs !== null && input.threadTs !== null && input.replyToTs !== input.threadTs) {
      throw new ConversationPlatformError(
        "platform_delivery_failed",
        "The Slack thread and reply address differ.",
      );
    }
    const body = {
      channel: input.channelId,
      text: plainText(input.text),
      mrkdwn: false,
      ...(threadTs === null ? {} : { thread_ts: threadTs, reply_broadcast: false }),
    };
    const requestHash = `sha256:${createHash("sha256")
      .update(
        JSON.stringify({
          teamId: input.teamId,
          body,
        }),
      )
      .digest("hex")}`;
    const result = await deliverPlatformMessageWithReplay({
      platform: "slack",
      integrationId: this.options.integrationId,
      outboundId: input.outboundId,
      requestHash,
      attemptedAt: this.now().toISOString(),
      replay: this.options.replay,
      unknownMessage:
        "The Slack delivery result is unknown, so the message was not resent. Operator review is required.",
      conflictMessage: "A different request is bound to the same Slack outbound ID.",
      rejectedMessage: "The Slack API rejected message delivery.",
      failureMessage: "The Slack delivery result could not be verified safely.",
      send: async () => {
        const response = object(
          await postPlatformJson({
            url: this.apiUrl,
            headers: { authorization: `Bearer ${this.options.botToken}` },
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
        if (response.ok === false) throw new PlatformDeliveryRejectedError();
        if (
          response.ok !== true ||
          typeof response.ts !== "string" ||
          !/^[0-9]{1,12}(?:\.[0-9]{1,6})?$/.test(response.ts)
        ) {
          throw new Error("Slack delivery response mismatch");
        }
        const deliveredAt = this.now().toISOString();
        return { externalMessageKey: response.ts, deliveredAt };
      },
    });
    return { messageTs: result.externalMessageKey, deliveredAt: result.deliveredAt };
  }
}
