import {
  ConversationPlatformError,
  objectValue,
  requiredString,
} from "@lervo/conversation-platform";
import { parseDiscordGoalInteraction, type DiscordGoalInteraction } from "./goal-interaction.js";

export interface ParsedDiscordMessage {
  kind: "message";
  messageId: string;
  channelId: string;
  guildId: string | null;
  participantKey: string;
  mentionedParticipantKeys: string[];
  actorKindHint: "human" | "agent";
  replyToMessageId: string | null;
  content: string;
  occurredAt: string;
}

export type ParsedDiscordGateway =
  | { kind: "ignored"; reason: string; sequence: number; eventName: string }
  | {
      kind: "goal_command";
      sequence: number;
      eventName: "INTERACTION_CREATE";
      command: DiscordGoalInteraction;
    }
  | (ParsedDiscordMessage & { sequence: number; eventName: "MESSAGE_CREATE" });

function snowflake(value: unknown, label: string): string {
  const result = requiredString(value, label, 32);
  if (!/^[0-9]{1,32}$/.test(result)) {
    throw new ConversationPlatformError("invalid_platform_payload", `${label} format is invalid.`);
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
    throw new ConversationPlatformError(
      "invalid_platform_payload",
      "The Discord message timestamp is invalid.",
    );
  }
  return new Date(milliseconds).toISOString();
}

function messageContent(value: unknown): string {
  if (typeof value !== "string" || value.length > 65_536) {
    throw new ConversationPlatformError(
      "invalid_platform_payload",
      "Discord message content is invalid.",
    );
  }
  return value;
}

function agentParticipantKey(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  const author = objectValue(message.author);
  const webhookId = optionalSnowflake(message.webhook_id, "Discord referenced webhook ID");
  if (webhookId !== null) return `webhook:${webhookId}`;
  return author.bot === true ? `bot:${snowflake(author.id, "Discord referenced author ID")}` : null;
}

export function parseDiscordGatewayPayload(
  value: unknown,
): { kind: "not_dispatch" } | ParsedDiscordGateway {
  const payload = objectValue(value);
  if (payload.op !== 0 || !Number.isSafeInteger(payload.s) || (payload.s as number) < 0) {
    return { kind: "not_dispatch" };
  }
  const sequence = payload.s as number;
  const eventName = requiredString(payload.t, "Discord Gateway event name", 64);
  if (eventName === "INTERACTION_CREATE") {
    const command = parseDiscordGoalInteraction(payload.d);
    return command === null
      ? { kind: "ignored", reason: "unsupported_interaction", sequence, eventName }
      : { kind: "goal_command", sequence, eventName, command };
  }
  if (eventName !== "MESSAGE_CREATE") {
    return { kind: "ignored", reason: "unsupported_gateway_event", sequence, eventName };
  }
  return { ...parseDiscordMessagePayload(payload.d), sequence, eventName };
}

export function parseDiscordMessagePayload(value: unknown): ParsedDiscordMessage {
  const message = objectValue(value);
  const author = objectValue(message.author);
  const bot = author.bot === true;
  const webhookId = optionalSnowflake(message.webhook_id, "Discord webhook ID");
  const mentionValues = Array.isArray(message.mentions) ? message.mentions : [];
  const content = messageContent(message.content);
  // allowed_mentions can suppress metadata without removing the sender's explicit address.
  const leadingAddress = /^\s*<@!?(\d{1,32})>(?=\s|$)/u.exec(content)?.[1];
  const reference =
    message.message_reference === undefined || message.message_reference === null
      ? null
      : objectValue(message.message_reference);
  const referencedAgent =
    bot || webhookId !== null ? null : agentParticipantKey(message.referenced_message);
  return {
    kind: "message",
    messageId: snowflake(message.id, "Discord message ID"),
    channelId: snowflake(message.channel_id, "Discord channel ID"),
    guildId: optionalSnowflake(message.guild_id, "Discord guild ID"),
    participantKey:
      webhookId === null
        ? `${bot ? "bot" : "user"}:${snowflake(author.id, "Discord author ID")}`
        : `webhook:${webhookId}`,
    mentionedParticipantKeys: [
      ...mentionValues.map(
        (item) => `user:${snowflake(objectValue(item).id, "Discord mentioned user ID")}`,
      ),
      ...(leadingAddress === undefined ? [] : [`user:${leadingAddress}`]),
      ...(referencedAgent === null ? [] : [referencedAgent]),
    ].filter((value, index, values) => values.indexOf(value) === index),
    actorKindHint: bot || webhookId !== null ? "agent" : "human",
    replyToMessageId:
      reference === null
        ? null
        : optionalSnowflake(reference.message_id, "Discord reply message ID"),
    content,
    occurredAt: isoTimestamp(message.timestamp),
  };
}
