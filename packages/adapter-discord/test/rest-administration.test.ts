import { describe, expect, it, vi } from "vitest";

import { DiscordRestAdministration } from "../src/index.js";

describe("Discord REST administration", () => {
  it("updates only the current bot member in an allowed guild and verifies the response", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ nick: "Lervo" });
      return new Response(
        JSON.stringify({
          nick: "Lervo",
          user: { id: "999999999999999999" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const administration = new DiscordRestAdministration({
      applicationId: "999999999999999999",
      botToken: `discord.${"t".repeat(40)}`,
      allowedGuildIds: ["123456789012345678"],
      apiBaseUrl: "http://discord.test/api/v10",
      allowInsecureHttpForTests: true,
      fetch: fetch as typeof globalThis.fetch,
      now: () => new Date("2026-09-08T12:00:00.000Z"),
    });

    await expect(
      administration.setCurrentMemberNickname({
        guildId: "123456789012345678",
        nickname: "Lervo",
      }),
    ).resolves.toEqual({
      guildId: "123456789012345678",
      applicationId: "999999999999999999",
      nickname: "Lervo",
      observedAt: "2026-09-08T12:00:00.000Z",
    });
    expect(String(fetch.mock.calls[0]![0])).toBe(
      "http://discord.test/api/v10/guilds/123456789012345678/members/@me",
    );
  });

  it("rejects a guild outside the explicit administration scope before calling Discord", async () => {
    const fetch = vi.fn();
    const administration = new DiscordRestAdministration({
      applicationId: "999999999999999999",
      botToken: `discord.${"t".repeat(40)}`,
      allowedGuildIds: ["123456789012345678"],
      fetch: fetch as typeof globalThis.fetch,
    });
    await expect(
      administration.setCurrentMemberNickname({ guildId: "223456789012345678", nickname: "Lervo" }),
    ).rejects.toMatchObject({ code: "invalid_platform_configuration" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates an allowlisted guild channel and verifies its exact response", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        name: "architecture",
        type: 0,
        topic: "System design",
        parent_id: null,
      });
      return new Response(
        JSON.stringify({
          id: "423456789012345678",
          guild_id: "123456789012345678",
          name: "architecture",
          type: 0,
          parent_id: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const administration = new DiscordRestAdministration({
      applicationId: "999999999999999999",
      botToken: `discord.${"t".repeat(40)}`,
      allowedGuildIds: ["123456789012345678"],
      apiBaseUrl: "http://discord.test/api/v10",
      allowInsecureHttpForTests: true,
      fetch: fetch as typeof globalThis.fetch,
      now: () => new Date("2026-09-08T12:00:00.000Z"),
    });
    await expect(
      administration.createGuildTextChannel({
        guildId: "123456789012345678",
        name: "architecture",
        topic: "System design",
        parentChannelId: null,
      }),
    ).resolves.toMatchObject({ channelId: "423456789012345678", name: "architecture" });
  });

  it("creates threads only inside an explicitly allowlisted channel", async () => {
    const fetch = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: "523456789012345678",
            guild_id: "123456789012345678",
            parent_id: "223456789012345678",
            name: "review",
            type: 11,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const administration = new DiscordRestAdministration({
      applicationId: "999999999999999999",
      botToken: `discord.${"t".repeat(40)}`,
      allowedGuildIds: ["123456789012345678"],
      allowedChannelIds: ["223456789012345678"],
      apiBaseUrl: "http://discord.test/api/v10",
      allowInsecureHttpForTests: true,
      fetch: fetch as typeof globalThis.fetch,
      now: () => new Date("2026-09-08T12:00:00.000Z"),
    });
    await expect(
      administration.createPublicThread({
        guildId: "123456789012345678",
        channelId: "323456789012345678",
        name: "review",
        autoArchiveDuration: 1440,
      }),
    ).rejects.toMatchObject({ code: "invalid_platform_configuration" });
    await expect(
      administration.createPublicThread({
        guildId: "123456789012345678",
        channelId: "223456789012345678",
        name: "review",
        autoArchiveDuration: 1440,
      }),
    ).resolves.toMatchObject({ threadId: "523456789012345678", name: "review" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("creates an incoming webhook only in an allowlisted channel and verifies its token", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe("http://discord.test/api/v10/channels/223456789012345678/webhooks");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ name: "Arac Reviewer" });
      return new Response(
        JSON.stringify({
          id: "623456789012345678",
          guild_id: "123456789012345678",
          channel_id: "223456789012345678",
          name: "Arac Reviewer",
          token: "w".repeat(40),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const administration = new DiscordRestAdministration({
      applicationId: "999999999999999999",
      botToken: `discord.${"t".repeat(40)}`,
      allowedGuildIds: ["123456789012345678"],
      allowedChannelIds: ["223456789012345678"],
      apiBaseUrl: "http://discord.test/api/v10",
      allowInsecureHttpForTests: true,
      fetch: fetch as typeof globalThis.fetch,
      now: () => new Date("2026-09-08T12:00:00.000Z"),
    });

    await expect(
      administration.createIncomingWebhook({
        guildId: "123456789012345678",
        channelId: "223456789012345678",
        name: "Arac Reviewer",
      }),
    ).resolves.toEqual({
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      webhookId: "623456789012345678",
      name: "Arac Reviewer",
      token: "w".repeat(40),
      observedAt: "2026-09-08T12:00:00.000Z",
    });
  });

  it("updates an incoming webhook name only inside the allowlisted channel", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe("http://discord.test/api/v10/webhooks/623456789012345678");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ name: "Sora" });
      return new Response(
        JSON.stringify({
          id: "623456789012345678",
          guild_id: "123456789012345678",
          channel_id: "223456789012345678",
          name: "Sora",
          type: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const administration = new DiscordRestAdministration({
      applicationId: "999999999999999999",
      botToken: `discord.${"t".repeat(40)}`,
      allowedGuildIds: ["123456789012345678"],
      allowedChannelIds: ["223456789012345678"],
      apiBaseUrl: "http://discord.test/api/v10",
      allowInsecureHttpForTests: true,
      fetch: fetch as typeof globalThis.fetch,
      now: () => new Date("2026-09-11T00:00:00.000Z"),
    });

    await expect(
      administration.updateIncomingWebhook({
        guildId: "123456789012345678",
        channelId: "223456789012345678",
        webhookId: "623456789012345678",
        name: "Sora",
      }),
    ).resolves.toEqual({
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      webhookId: "623456789012345678",
      name: "Sora",
      observedAt: "2026-09-11T00:00:00.000Z",
    });
  });

  it("deletes an incoming webhook idempotently only inside the allowlisted channel", async () => {
    let status = 204;
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe("http://discord.test/api/v10/webhooks/623456789012345678");
      expect(init?.method).toBe("DELETE");
      const response = new Response(null, { status });
      status = 404;
      return response;
    });
    const administration = new DiscordRestAdministration({
      applicationId: "999999999999999999",
      botToken: `discord.${"t".repeat(40)}`,
      allowedGuildIds: ["123456789012345678"],
      allowedChannelIds: ["223456789012345678"],
      apiBaseUrl: "http://discord.test/api/v10",
      allowInsecureHttpForTests: true,
      fetch: fetch as typeof globalThis.fetch,
      now: () => new Date("2026-09-11T00:00:03.000Z"),
    });

    await expect(
      administration.deleteIncomingWebhook({
        guildId: "123456789012345678",
        channelId: "223456789012345678",
        webhookId: "623456789012345678",
      }),
    ).resolves.toEqual({
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      webhookId: "623456789012345678",
      observedAt: "2026-09-11T00:00:03.000Z",
    });
    await expect(
      administration.deleteIncomingWebhook({
        guildId: "123456789012345678",
        channelId: "223456789012345678",
        webhookId: "623456789012345678",
      }),
    ).resolves.toMatchObject({ webhookId: "623456789012345678" });
  });
});
