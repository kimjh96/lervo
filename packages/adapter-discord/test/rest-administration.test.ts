import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson } from "@lervo/event-contract";

import {
  DiscordOrganizationExecutiveEffectAdapter,
  DiscordRestAdministration,
} from "../src/index.js";

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
    const parameters = {
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      name: "review",
      autoArchiveDuration: 1440,
    };
    const adapter = new DiscordOrganizationExecutiveEffectAdapter(administration);
    await expect(
      adapter.apply({
        schemaVersion: 1,
        effectId: "ceoe_threadreview01",
        organizationId: "org_lervoowner01",
        teamId: "team_lervocore01",
        action: "conversation.thread.create",
        adapterId: adapter.adapterId,
        parameters,
        parametersHash: `sha256:${createHash("sha256").update(canonicalJson(parameters)).digest("hex")}`,
      }),
    ).resolves.toMatchObject({ status: "completed", externalEffectId: "523456789012345678" });
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

  it("prepares a webhook deployment through the executive adapter without returning its token", async () => {
    const fetch = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: "623456789012345678",
            guild_id: "123456789012345678",
            channel_id: "223456789012345678",
            name: "Plen Engineer",
            token: "w".repeat(40),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const store = vi.fn(async () => ({ credentialReferenceHash: `sha256:${"e".repeat(64)}` }));
    const adapter = new DiscordOrganizationExecutiveEffectAdapter(
      new DiscordRestAdministration({
        applicationId: "999999999999999999",
        botToken: `discord.${"t".repeat(40)}`,
        allowedGuildIds: ["123456789012345678"],
        allowedChannelIds: ["223456789012345678"],
        apiBaseUrl: "http://discord.test/api/v10",
        allowInsecureHttpForTests: true,
        fetch: fetch as typeof globalThis.fetch,
        now: () => new Date("2026-09-08T12:00:00.000Z"),
      }),
      { store },
    );
    const parameters = {
      integrationId: "itg_discord01",
      agentId: `agt_${"a".repeat(24)}`,
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      name: "Plen Engineer",
    };
    const result = await adapter.apply({
      schemaVersion: 1,
      effectId: "ceoe_webhook01",
      organizationId: "org_lervoowner01",
      teamId: "team_lervocore01",
      action: "agent.deployment.prepare",
      adapterId: adapter.adapterId,
      parameters,
      parametersHash: `sha256:${createHash("sha256").update(canonicalJson(parameters)).digest("hex")}`,
    });

    expect(adapter.actions).toContain("agent.deployment.prepare");
    expect(store).toHaveBeenCalledWith({
      effectId: "ceoe_webhook01",
      webhookId: "623456789012345678",
      token: "w".repeat(40),
    });
    expect(result).toMatchObject({
      status: "completed",
      externalEffectId: "623456789012345678",
    });
    expect(JSON.stringify(result)).not.toContain("w".repeat(40));
  });
});
