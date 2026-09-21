import { describe, expect, it, vi } from "vitest";

import { DiscordRestManagedBotRoles } from "../src/rest-managed-bot-roles.js";

const guildId = "123456789012345678";
const managedRoleId = "223456789012345678";
const ordinaryRoleId = "323456789012345678";
const botId = "423456789012345678";

function resolver(roles: unknown, status = 200) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(roles), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  return {
    fetch,
    roles: new DiscordRestManagedBotRoles({
      botToken: "fixture-bot-token-long-enough",
      allowedGuildIds: [guildId],
      fetch,
      apiBaseUrl: "http://127.0.0.1:18443/api/v10",
      allowInsecureHttpForTests: true,
    }),
  };
}

describe("Discord managed bot role resolution", () => {
  it("maps only the authenticated managed bot role, without trusting its name", async () => {
    const { roles, fetch } = resolver([
      { id: managedRoleId, name: "Someone Else", managed: true, tags: { bot_id: botId } },
      { id: ordinaryRoleId, name: "Elio", managed: false, tags: {} },
    ]);
    await expect(
      roles.resolve({ guildId, roleIds: [managedRoleId, ordinaryRoleId] }),
    ).resolves.toEqual([{ roleId: managedRoleId, botId }]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("fails closed outside the allowed guild or when role verification fails", async () => {
    const { roles, fetch } = resolver([], 403);
    await expect(
      roles.resolve({ guildId: "999999999999999999", roleIds: [managedRoleId] }),
    ).rejects.toMatchObject({ code: "identity_mapping_failed" });
    expect(fetch).not.toHaveBeenCalled();
    await expect(roles.resolve({ guildId, roleIds: [managedRoleId] })).rejects.toMatchObject({
      code: "identity_mapping_failed",
    });
  });
});
