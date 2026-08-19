import {
  ConversationPlatformError,
  objectValue,
  requiredString,
} from "@lervo/conversation-platform";

export type ParsedDiscordGateway =
  | { kind: "ignored"; reason: string; sequence: number; eventName: string }
  | {
      kind: "message";
      sequence: number;
      eventName: "MESSAGE_CREATE";
      messageId: string;
      channelId: string;
      guildId: string | null;
      participantKey: string;
      mentionedParticipantKeys: string[];
      actorKindHint: "human" | "agent";
      replyToMessageId: string | null;
      content: string;
      occurredAt: string;
    };

function snowflake(value: unknown, label: string): string {
  const result = requiredString(value, label, 32);
  if (!/^[0-9]{1,32}$/.test(result)) {
    throw new ConversationPlatformError("invalid_platform_payload", `${label} 형식이 유효하지 않습니다.`);
  }
  return result;
}

function optionalSnowflake(value: unknown, label: string): string | null {
  return value === undefined || value === null ? null : snowflake(value, label);
}

function isoTimestamp(value: unknown): string {
  const timestamp = requiredString(value, "Discord message timestamp", 64);
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) {
    throw new ConversationPlatformError("invalid_platform_payload", "Discord message timestamp가 유효하지 않습니다.");
  }
  return new Date(milliseconds).toISOString();
}

export function parseDiscordGatewayPayload(value: unknown):
  | { kind: "not_dispatch" }
  | ParsedDiscordGateway {
  const payload = objectValue(value);
  if (payload.op !== 0 || !Number.isSafeInteger(payload.s) || (payload.s as number) < 0) {
    return { kind: "not_dispatch" };
  }
  const sequence = payload.s as number;
  const eventName = requiredString(payload.t, "Discord Gateway event name", 64);
  if (eventName !== "MESSAGE_CREATE") {
    return { kind: "ignored", reason: "unsupported_gateway_event", sequence, eventName };
  }
  const message = objectValue(payload.d);
  const author = objectValue(message.author);
  const bot = author.bot === true;
  const mentionValues = Array.isArray(message.mentions) ? message.mentions : [];
  const reference = message.message_reference === undefined || message.message_reference === null
    ? null
    : objectValue(message.message_reference);
  return {
    kind: "message",
    sequence,
    eventName,
    messageId: snowflake(message.id, "Discord message ID"),
    channelId: snowflake(message.channel_id, "Discord channel ID"),
    guildId: optionalSnowflake(message.guild_id, "Discord guild ID"),
    participantKey: `${bot ? "bot" : "user"}:${snowflake(author.id, "Discord author ID")}`,
    mentionedParticipantKeys: mentionValues.map((item) =>
      `user:${snowflake(objectValue(item).id, "Discord mentioned user ID")}`,
    ),
    actorKindHint: bot ? "agent" : "human",
    replyToMessageId: reference === null
      ? null
      : optionalSnowflake(reference.message_id, "Discord reply message ID"),
    content: requiredString(message.content, "Discord message content", 65_536),
    occurredAt: isoTimestamp(message.timestamp),
  };
}
