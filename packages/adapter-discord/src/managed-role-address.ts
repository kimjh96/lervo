import type { DiscordManagedBotRolePort } from "./types.js";

/** An unknown role address must never fall through to ordinary unaddressed ownership. */
export async function resolveManagedBotRoleAddresses(input: {
  guildId: string | null;
  roleIds: readonly string[];
  resolver?: DiscordManagedBotRolePort;
}): Promise<string[] | null> {
  if (input.roleIds.length === 0) return [];
  if (input.guildId === null || input.resolver === undefined) return null;
  const resolved = await input.resolver.resolve({
    guildId: input.guildId,
    roleIds: input.roleIds,
  });
  if (
    resolved.length !== input.roleIds.length ||
    resolved.some(
      (role, index) => role.roleId !== input.roleIds[index] || !/^[0-9]{1,32}$/u.test(role.botId),
    )
  )
    return null;
  return resolved.map((role) => `bot:${role.botId}`);
}
