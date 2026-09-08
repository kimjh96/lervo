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
});
