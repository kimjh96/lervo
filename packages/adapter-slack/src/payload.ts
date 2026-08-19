import {
  ConversationPlatformError,
  objectValue,
  requiredString,
} from "@lervo/conversation-platform";

export type ParsedSlackIngress =
  | { kind: "challenge"; challenge: string }
  | { kind: "ignored"; reason: string }
  | {
      kind: "message";
      teamId: string;
      eventId: string;
      channelId: string;
      messageTs: string;
      threadTs: string | null;
      text: string;
      participantKey: string;
      mentionedParticipantKeys: string[];
      actorKindHint: "human" | "agent";
      occurredAt: string;
    };

function slackTimestamp(value: unknown): string {
  const source = requiredString(value, "Slack message timestamp", 32);
  if (!/^[0-9]{1,12}(?:\.[0-9]{1,6})?$/.test(source)) {
    throw new ConversationPlatformError("invalid_platform_payload", "Slack timestamp가 유효하지 않습니다.");
  }
  const milliseconds = Number(source) * 1_000;
  if (!Number.isFinite(milliseconds)) {
    throw new ConversationPlatformError("invalid_platform_payload", "Slack timestamp가 유효하지 않습니다.");
  }
  return new Date(milliseconds).toISOString();
}

function mentions(text: string): string[] {
  return [...new Set([...text.matchAll(/<@([A-Z0-9]+)>/g)].map((match) => match[1]!))]
    .sort()
    .map((id) => `user:${id}`);
}

export function parseSlackIngress(input: {
  value: unknown;
  apiAppId: string;
  allowedTeamIds: ReadonlySet<string>;
}): ParsedSlackIngress {
  const outer = objectValue(input.value);
  const type = requiredString(outer.type, "Slack outer event type", 64);
  if (type === "url_verification") {
    return { kind: "challenge", challenge: requiredString(outer.challenge, "Slack challenge", 512) };
  }
  if (type !== "event_callback") return { kind: "ignored", reason: "unsupported_outer_event" };
  const appId = requiredString(outer.api_app_id, "Slack app ID", 128);
  const teamId = requiredString(outer.team_id, "Slack team ID", 128);
  if (appId !== input.apiAppId || !input.allowedTeamIds.has(teamId)) {
    throw new ConversationPlatformError("platform_authentication_failed", "Slack app 또는 team scope가 다릅니다.");
  }
  const eventId = requiredString(outer.event_id, "Slack event ID", 128);
  const event = objectValue(outer.event);
  const eventType = requiredString(event.type, "Slack event type", 64);
  if (eventType !== "message" && eventType !== "app_mention") {
    return { kind: "ignored", reason: "unsupported_event_type" };
  }
  const subtype = event.subtype;
  if (subtype !== undefined && subtype !== "bot_message" && subtype !== "thread_broadcast") {
    return { kind: "ignored", reason: "unsupported_message_subtype" };
  }
  const messageTs = requiredString(event.ts, "Slack message ID", 32);
  const threadTs = event.thread_ts === undefined
    ? null
    : requiredString(event.thread_ts, "Slack thread ID", 32);
  const text = requiredString(event.text, "Slack message text", 65_536);
  const bot = subtype === "bot_message" || event.bot_id !== undefined;
  return {
    kind: "message",
    teamId,
    eventId,
    channelId: requiredString(event.channel, "Slack channel ID", 128),
    messageTs,
    threadTs,
    text,
    participantKey: bot
      ? `bot:${requiredString(event.bot_id, "Slack bot ID", 128)}`
      : `user:${requiredString(event.user, "Slack user ID", 128)}`,
    mentionedParticipantKeys: mentions(text),
    actorKindHint: bot ? "agent" : "human",
    occurredAt: slackTimestamp(event.event_ts ?? event.ts),
  };
}
