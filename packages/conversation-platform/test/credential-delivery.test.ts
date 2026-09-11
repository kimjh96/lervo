import {
  DiscordRestDelivery,
  DiscordRestConversationAddress,
  DiscordRestHistory,
  DiscordRestTyping,
  DiscordRestWebhookDelivery,
} from "@lervo/adapter-discord";
import { SlackWebApiDelivery } from "@lervo/adapter-slack";
import type {
  ConversationPlatformDeliveryReplayPort,
  PlatformDeliveryReplayDecision,
} from "@lervo/conversation-platform";
import { describe, expect, it, vi } from "vitest";

type Begin = Parameters<ConversationPlatformDeliveryReplayPort["begin"]>[0];
type Complete = Parameters<ConversationPlatformDeliveryReplayPort["complete"]>[0];

class MemoryReplay implements ConversationPlatformDeliveryReplayPort {
  private readonly records = new Map<
    string,
    {
      hash: string;
      status: "sending" | "unknown" | "rejected" | "delivered";
      externalMessageKey?: string;
      deliveredAt?: string;
    }
  >();

  async begin(input: Begin): Promise<PlatformDeliveryReplayDecision> {
    const key = `${input.platform}:${input.integrationId}:${input.outboundId}`;
    const current = this.records.get(key);
    if (current === undefined) {
      this.records.set(key, { hash: input.requestHash, status: "sending" });
      return { status: "reserved" };
    }
    if (current.hash !== input.requestHash) return { status: "conflict" };
    if (current.status === "unknown" || current.status === "sending") return { status: "unknown" };
    if (current.status === "rejected") return { status: "rejected" };
    return {
      status: "delivered",
      externalMessageKey: current.externalMessageKey!,
      deliveredAt: current.deliveredAt!,
    };
  }

  async complete(input: Complete): Promise<void> {
    const key = `${input.platform}:${input.integrationId}:${input.outboundId}`;
    this.records.set(key, {
      hash: input.requestHash,
      status: "delivered",
      externalMessageKey: input.externalMessageKey,
      deliveredAt: input.deliveredAt,
    });
  }

  async markUnknown(
    input: Parameters<ConversationPlatformDeliveryReplayPort["markUnknown"]>[0],
  ): Promise<void> {
    const key = `${input.platform}:${input.integrationId}:${input.outboundId}`;
    this.records.set(key, { hash: input.requestHash, status: "unknown" });
  }

  async markRejected(
    input: Parameters<ConversationPlatformDeliveryReplayPort["markRejected"]>[0],
  ): Promise<void> {
    const key = `${input.platform}:${input.integrationId}:${input.outboundId}`;
    this.records.set(key, { hash: input.requestHash, status: "rejected" });
  }
}

const outboundId = `cvo_${"a".repeat(64)}`;
const at = "2026-08-20T01:00:00.000Z";

describe("credential-backed platform delivery", () => {
  it("uses Slack OAuth without active markup and replays one confirmed message", async () => {
    const replay = new MemoryReplay();
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: `Bearer xoxb-${"s".repeat(40)}` });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        channel: "C123",
        text: "Review &lt;@U123&gt; &amp; confirm",
        mrkdwn: false,
        thread_ts: "1710000000.000100",
        reply_broadcast: false,
      });
      return new Response(JSON.stringify({ ok: true, channel: "C123", ts: "1710000001.000100" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const delivery = new SlackWebApiDelivery({
      integrationId: "itg_slack001",
      botToken: `xoxb-${"s".repeat(40)}`,
      replay,
      fetch: request as typeof fetch,
      now: () => new Date(at),
    });
    const input = {
      outboundId,
      teamId: "T123",
      channelId: "C123",
      threadTs: "1710000000.000100",
      replyToTs: "1710000000.000100",
      text: "Review <@U123> & confirm",
      automationDepth: 1,
      format: "plain" as const,
    };
    await expect(delivery.send(input)).resolves.toEqual({
      messageTs: "1710000001.000100",
      deliveredAt: at,
    });
    await expect(delivery.send(input)).resolves.toEqual({
      messageTs: "1710000001.000100",
      deliveredAt: at,
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("sends Discord with an enforced nonce and disables all mention parsing", async () => {
    const replay = new MemoryReplay();
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://discord.com/api/v10/channels/333456789012345678/messages");
      expect(init?.headers).toMatchObject({ authorization: `Bot ${"d".repeat(40)}` });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        content: "Do not mention <@123> directly.",
        enforce_nonce: true,
        allowed_mentions: { parse: [], replied_user: false },
        message_reference: { message_id: "323456789012345678", fail_if_not_exists: false },
      });
      expect(typeof body.nonce).toBe("string");
      expect((body.nonce as string).length).toBeLessThanOrEqual(25);
      return new Response(
        JSON.stringify({
          id: "423456789012345678",
          channel_id: "333456789012345678",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const delivery = new DiscordRestDelivery({
      integrationId: "itg_discord01",
      botToken: "d".repeat(40),
      replay,
      fetch: request as typeof fetch,
      now: () => new Date(at),
    });
    const input = {
      outboundId,
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      threadId: "333456789012345678",
      replyToMessageId: "323456789012345678",
      content: "Do not mention <@123> directly.",
      automationDepth: 1,
      allowedMentions: "none" as const,
      enforceIdempotency: true as const,
    };
    await expect(delivery.send(input)).resolves.toEqual({
      messageId: "423456789012345678",
      deliveredAt: at,
    });
    await delivery.send(input);
    expect(request).toHaveBeenCalledOnce();
  });

  it("sends as a named Discord webhook identity without exposing its credential", async () => {
    const replay = new MemoryReplay();
    const webhookToken = "w".repeat(40);
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        `https://discord.com/api/v10/webhooks/523456789012345678/${webhookToken}?wait=true&thread_id=333456789012345678`,
      );
      expect(init?.headers).not.toHaveProperty("authorization");
      expect(JSON.parse(String(init?.body))).toEqual({
        content: "Review complete.",
        username: "Arac Reviewer",
        avatar_url: "https://example.com/arac.png",
        allowed_mentions: { parse: [], replied_user: false },
      });
      return new Response(
        JSON.stringify({
          id: "423456789012345678",
          channel_id: "333456789012345678",
          webhook_id: "523456789012345678",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const delivery = new DiscordRestWebhookDelivery({
      integrationId: "itg_discord02",
      webhookId: "523456789012345678",
      webhookToken,
      parentChannelId: "223456789012345678",
      username: "Arac Reviewer",
      avatarUrl: "https://example.com/arac.png",
      replay,
      fetch: request as typeof fetch,
      now: () => new Date(at),
    });
    const input = {
      outboundId,
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      threadId: "333456789012345678",
      replyToMessageId: "323456789012345678",
      content: "Review complete.",
      automationDepth: 1,
      allowedMentions: "none" as const,
      enforceIdempotency: true as const,
    };
    await expect(delivery.send(input)).resolves.toEqual({
      messageId: "423456789012345678",
      deliveredAt: at,
    });
    await delivery.send(input);
    expect(request).toHaveBeenCalledOnce();
  });

  it("redacts a Discord webhook token from an ambiguous transport failure", async () => {
    const replay = new MemoryReplay();
    const webhookToken = "secret-webhook-token-".padEnd(40, "w");
    const delivery = new DiscordRestWebhookDelivery({
      integrationId: "itg_discord03",
      webhookId: "523456789012345678",
      webhookToken,
      parentChannelId: "223456789012345678",
      username: "Shiflo Designer",
      replay,
      fetch: async (url) => {
        throw new Error(`connection failed for ${String(url)}`);
      },
      now: () => new Date(at),
    });
    const input = {
      outboundId,
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      threadId: null,
      replyToMessageId: null,
      content: "Draft ready.",
      automationDepth: 1,
      allowedMentions: "none" as const,
      enforceIdempotency: true as const,
    };

    let observed = "";
    try {
      await delivery.send(input);
    } catch (error) {
      observed = String(error);
    }
    expect(observed).not.toContain(webhookToken);
    await expect(delivery.send(input)).rejects.toThrow("Operator review is required");
  });

  it("resolves an authenticated Discord thread to its configured parent conversation", async () => {
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://discord.com/api/v10/channels/333456789012345678");
      expect(init?.headers).toMatchObject({ authorization: `Bot ${"d".repeat(40)}` });
      return new Response(
        JSON.stringify({
          id: "333456789012345678",
          guild_id: "123456789012345678",
          parent_id: "223456789012345678",
          type: 11,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const addresses = new DiscordRestConversationAddress({
      botToken: "d".repeat(40),
      allowedGuildIds: ["123456789012345678"],
      parentChannelIds: ["223456789012345678"],
      fetch: request as typeof fetch,
    });

    await expect(
      addresses.resolve({
        guildId: "123456789012345678",
        channelId: "223456789012345678",
      }),
    ).resolves.toEqual({ conversationKey: "223456789012345678", threadKey: null });
    expect(request).not.toHaveBeenCalled();
    await expect(
      addresses.resolve({
        guildId: "123456789012345678",
        channelId: "333456789012345678",
      }),
    ).resolves.toEqual({
      conversationKey: "223456789012345678",
      threadKey: "333456789012345678",
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("ignores a Discord channel whose parent is outside the configured conversation scope", async () => {
    const addresses = new DiscordRestConversationAddress({
      botToken: "d".repeat(40),
      allowedGuildIds: ["123456789012345678"],
      parentChannelIds: ["223456789012345678"],
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: "333456789012345678",
            guild_id: "123456789012345678",
            parent_id: "923456789012345678",
            type: 11,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(
      addresses.resolve({
        guildId: "123456789012345678",
        channelId: "333456789012345678",
      }),
    ).resolves.toBeNull();
  });

  it("retrieves bounded Discord history after the durable channel cursor", async () => {
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://discord.com/api/v10/channels/223456789012345678/messages?limit=100&after=323456789012345678",
      );
      expect(init).toMatchObject({
        method: "GET",
        headers: { accept: "application/json", authorization: `Bot ${"d".repeat(40)}` },
      });
      return new Response(
        JSON.stringify([
          {
            id: "423456789012345678",
            channel_id: "223456789012345678",
            guild_id: "123456789012345678",
            author: { id: "523456789012345678", bot: false },
            content: "Recover this message.",
            timestamp: at,
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const history = new DiscordRestHistory({
      botToken: "d".repeat(40),
      fetch: request as typeof fetch,
    });

    const messages = await history.list({
      channelId: "223456789012345678",
      after: "323456789012345678",
      limit: 100,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ messageId: "423456789012345678" });
    expect(JSON.parse(Buffer.from(messages[0]!.body).toString("utf8"))).toMatchObject({
      content: "Recover this message.",
    });
  });

  it("refreshes Discord typing activity and stops without affecting message delivery", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(String(_url)).toBe("https://discord.com/api/v10/channels/223456789012345678/typing");
        expect(init).toMatchObject({
          method: "POST",
          headers: { authorization: `Bot ${"d".repeat(40)}` },
        });
        expect(init?.body).toBeUndefined();
        return new Response(null, { status: 204 });
      });
      const typing = new DiscordRestTyping({
        botToken: "d".repeat(40),
        fetch: request as typeof fetch,
        refreshIntervalMs: 1_000,
      });
      const lease = typing.start({ channelId: "223456789012345678" });
      await vi.advanceTimersByTimeAsync(0);
      expect(request).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(request).toHaveBeenCalledTimes(2);
      lease.stop();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not resend when the first API result is ambiguous", async () => {
    const replay = new MemoryReplay();
    const request = vi.fn(async () => {
      throw new Error("connection reset after write");
    });
    const credential = `xoxb-${"private".repeat(8)}`;
    const delivery = new SlackWebApiDelivery({
      integrationId: "itg_slack001",
      botToken: credential,
      replay,
      fetch: request as typeof fetch,
      now: () => new Date(at),
    });
    const input = {
      outboundId,
      teamId: "T123",
      channelId: "C123",
      threadTs: null,
      replyToTs: null,
      text: "response-loss check",
      automationDepth: 1,
      format: "plain" as const,
    };
    await expect(delivery.send(input)).rejects.toMatchObject({ code: "platform_delivery_failed" });
    await expect(delivery.send(input)).rejects.toThrow("Operator review is required");
    expect(request).toHaveBeenCalledOnce();
    try {
      await delivery.send(input);
    } catch (error) {
      expect(String(error)).not.toContain(credential);
    }
  });

  it("keeps an explicit Slack rejection distinct from an unknown response", async () => {
    const replay = new MemoryReplay();
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: "channel_not_found",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const delivery = new SlackWebApiDelivery({
      integrationId: "itg_slack001",
      botToken: `xoxb-${"s".repeat(40)}`,
      replay,
      fetch: request as typeof fetch,
      now: () => new Date(at),
    });
    const input = {
      outboundId,
      teamId: "T123",
      channelId: "C404",
      threadTs: null,
      replyToTs: null,
      text: "rejection-state check",
      automationDepth: 1,
      format: "plain" as const,
    };
    await expect(delivery.send(input)).rejects.toThrow("rejected message delivery");
    await expect(delivery.send(input)).rejects.toThrow("rejected message delivery");
    expect(request).toHaveBeenCalledOnce();
  });
});
