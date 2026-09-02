import {
  assertPlatformHttpLimits,
  platformApiUrl,
  postPlatformJson,
} from "@lervo/conversation-platform";

import type { SlackAssignmentTransportV1 } from "./assignment-types.js";

export interface SlackAssignmentWebApiTransportOptions {
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  apiUrl?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  allowInsecureHttpForTests?: boolean;
}

function responseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Slack response is not an object.");
  }
  return value as Record<string, unknown>;
}

export class SlackAssignmentWebApiTransport implements SlackAssignmentTransportV1 {
  private readonly now: () => Date;
  private readonly apiUrl: string;

  constructor(private readonly options: SlackAssignmentWebApiTransportOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.apiUrl = options.apiUrl ?? "https://slack.com/api/chat.postMessage";
    platformApiUrl(this.apiUrl, options.allowInsecureHttpForTests === true);
    assertPlatformHttpLimits(options);
  }

  async send(input: Parameters<SlackAssignmentTransportV1["send"]>[0]) {
    try {
      const body = {
        channel: input.channelId,
        text: input.text,
        mrkdwn: false,
        unfurl_links: false,
        unfurl_media: false,
        ...(input.threadTs === null ? {} : { thread_ts: input.threadTs, reply_broadcast: false }),
      };
      const response = responseObject(
        await postPlatformJson({
          url: this.apiUrl,
          headers: { authorization: `Bearer ${input.botToken}` },
          body,
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
      if (response.ok === false) return { status: "rejected" as const };
      if (
        response.ok !== true ||
        response.channel !== input.channelId ||
        typeof response.ts !== "string" ||
        !/^[0-9]{1,12}(?:\.[0-9]{1,6})?$/u.test(response.ts)
      ) {
        return { status: "unknown" as const };
      }
      return {
        status: "delivered" as const,
        messageTs: response.ts,
        deliveredAt: this.now().toISOString(),
      };
    } catch {
      return { status: "unknown" as const };
    }
  }
}
