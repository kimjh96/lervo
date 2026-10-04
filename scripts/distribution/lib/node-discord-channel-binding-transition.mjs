import { isDeepStrictEqual } from "node:util";

const bindingFields = ["tenantKey", "conversationKey", "conversationId"];

function exactBinding(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).length === bindingFields.length &&
    bindingFields.every((field) => typeof value[field] === "string" && value[field].length > 0)
  );
}

/** Return the sole reviewed expansion: one existing shared Discord channel on one identity. */
export function applySharedDiscordChannelBinding(before, after) {
  if (!Array.isArray(before.discordConversations) || !Array.isArray(after.discordConversations))
    return false;
  if (before.discordConversations.length !== after.discordConversations.length) return false;
  const expected = structuredClone(before);
  let added = false;
  for (let index = 0; index < expected.discordConversations.length; index += 1) {
    const current = expected.discordConversations[index];
    const candidate = after.discordConversations[index];
    if (!Array.isArray(current.conversations) || !Array.isArray(candidate?.conversations))
      return false;
    if (candidate.conversations.length === current.conversations.length) continue;
    if (added || candidate.conversations.length !== current.conversations.length + 1) return false;
    const binding = candidate.conversations.at(-1);
    if (
      !exactBinding(binding) ||
      current.conversations.length >= 8 ||
      !current.allowedGuildIds?.includes(binding.tenantKey) ||
      current.conversations.some(
        (existing) =>
          existing.conversationId === binding.conversationId ||
          existing.conversationKey === binding.conversationKey,
      ) ||
      !expected.discordConversations.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.conversations.some((existing) => isDeepStrictEqual(existing, binding)),
      )
    )
      return false;
    current.conversations.push(binding);
    added = true;
  }
  return added && isDeepStrictEqual(expected, after);
}
