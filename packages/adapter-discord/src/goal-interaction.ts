import {
  ConversationPlatformError,
  objectValue,
  requiredString,
} from "@lervo/conversation-platform";

export interface DiscordGoalInteraction {
  interactionId: string;
  applicationId: string;
  token: string;
  guildId: string;
  channelId: string;
  userId: string;
  request: string;
}

function snowflake(value: unknown, label: string): string {
  const result = requiredString(value, label, 32);
  if (!/^[0-9]{1,32}$/u.test(result))
    throw new ConversationPlatformError("invalid_platform_payload", `${label} is invalid.`);
  return result;
}

/** Parses only the reviewed guild /goal command; other interactions remain outside this route. */
export function parseDiscordGoalInteraction(value: unknown): DiscordGoalInteraction | null {
  const interaction = objectValue(value);
  if (interaction.type !== 2) return null;
  const data = objectValue(interaction.data);
  if (data.name !== "goal") return null;
  if (data.type !== 1 || !Array.isArray(data.options) || data.options.length !== 1)
    throw new ConversationPlatformError(
      "invalid_platform_payload",
      "The /goal options are invalid.",
    );
  const option = objectValue(data.options[0]);
  const request = requiredString(option.value, "Discord /goal request", 4_000);
  if (
    option.name !== "request" ||
    option.type !== 3 ||
    request.trim().length === 0 ||
    request.includes("\0")
  )
    throw new ConversationPlatformError(
      "invalid_platform_payload",
      "The /goal request is invalid.",
    );
  const token = requiredString(interaction.token, "Discord interaction token", 512);
  if (!/^[\x21-\x7e]+$/u.test(token))
    throw new ConversationPlatformError("invalid_platform_payload", "The /goal token is invalid.");
  const member = objectValue(interaction.member);
  const user = objectValue(member.user);
  if (user.bot === true)
    throw new ConversationPlatformError("invalid_platform_payload", "A bot cannot invoke /goal.");
  return {
    interactionId: snowflake(interaction.id, "Discord interaction ID"),
    applicationId: snowflake(interaction.application_id, "Discord application ID"),
    token,
    guildId: snowflake(interaction.guild_id, "Discord guild ID"),
    channelId: snowflake(interaction.channel_id, "Discord channel ID"),
    userId: snowflake(user.id, "Discord user ID"),
    request,
  };
}
