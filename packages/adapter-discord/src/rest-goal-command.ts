import {
  ConversationPlatformError,
  getPlatformJson,
  patchPlatformJson,
  platformApiUrl,
  postPlatformJson,
} from "@lervo/conversation-platform";

import type { DiscordGoalInteraction } from "./goal-interaction.js";

const GOAL_COMMAND = {
  name: "goal",
  type: 1,
  description: "담당자에게 작업 목표를 요청합니다",
  options: [
    {
      name: "request",
      description: "달성할 목표와 완료 기준",
      type: 3,
      required: true,
      max_length: 4_000,
    },
  ],
  default_member_permissions: null,
  nsfw: false,
} as const;

interface GoalCommandRestOptions {
  applicationId: string;
  botToken: string;
  allowedGuildIds: readonly string[];
  fetch?: typeof globalThis.fetch;
  apiBaseUrl?: string;
  allowInsecureHttpForTests?: boolean;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ConversationPlatformError(
      "platform_delivery_failed",
      "The Discord /goal response is invalid.",
    );
  return value as Record<string, unknown>;
}

function messageReceipt(
  value: unknown,
  channelId: string,
): { messageId: string; occurredAt: string } {
  const message = record(value);
  const timestamp = typeof message.timestamp === "string" ? Date.parse(message.timestamp) : NaN;
  if (
    typeof message.id !== "string" ||
    !/^[0-9]{1,32}$/u.test(message.id) ||
    message.channel_id !== channelId ||
    !Number.isFinite(timestamp)
  )
    throw new ConversationPlatformError(
      "platform_delivery_failed",
      "The Discord /goal message identity differs.",
    );
  return { messageId: message.id, occurredAt: new Date(timestamp).toISOString() };
}

/** Owns guild command registration and the bounded interaction response window. */
export class DiscordRestGoalCommand {
  private readonly apiBaseUrl: string;
  private readonly guilds: ReadonlySet<string>;

  constructor(private readonly options: GoalCommandRestOptions) {
    if (
      !/^[0-9]{1,32}$/u.test(options.applicationId) ||
      options.botToken.length < 20 ||
      options.botToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/u.test(options.botToken) ||
      options.allowedGuildIds.length === 0 ||
      options.allowedGuildIds.some((id) => !/^[0-9]{1,32}$/u.test(id)) ||
      new Set(options.allowedGuildIds).size !== options.allowedGuildIds.length
    )
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord /goal registration scope is invalid.",
      );
    this.guilds = new Set(options.allowedGuildIds);
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://discord.com/api/v10").replace(/\/$/u, "");
    platformApiUrl(this.apiBaseUrl, options.allowInsecureHttpForTests === true);
  }

  async register(): Promise<void> {
    for (const guildId of this.guilds) {
      const url = `${this.apiBaseUrl}/applications/${this.options.applicationId}/guilds/${guildId}/commands`;
      const existing = await getPlatformJson({
        url,
        headers: { authorization: `Bot ${this.options.botToken}` },
        ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
        allowInsecureHttpForTests: this.options.allowInsecureHttpForTests === true,
      });
      if (!Array.isArray(existing))
        throw new ConversationPlatformError(
          "platform_ingress_failed",
          "The Discord command list is invalid.",
        );
      const goal = existing.find((entry) => {
        const command = record(entry);
        return command.name === "goal" && command.type === 1;
      });
      if (goal !== undefined) {
        if (!this.matches(goal))
          throw new ConversationPlatformError(
            "invalid_platform_configuration",
            "An existing /goal command has a different reviewed contract.",
          );
        continue;
      }
      const created = record(
        await postPlatformJson({
          url,
          headers: { authorization: `Bot ${this.options.botToken}` },
          body: GOAL_COMMAND,
          ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
          allowInsecureHttpForTests: this.options.allowInsecureHttpForTests === true,
        }),
      );
      if (created.name !== "goal" || created.type !== 1 || created.guild_id !== guildId)
        throw new ConversationPlatformError(
          "platform_delivery_failed",
          "Discord did not confirm the /goal command.",
        );
    }
  }

  private matches(value: unknown): boolean {
    const command = record(value);
    const option = Array.isArray(command.options) ? command.options[0] : null;
    const request = option === null ? null : record(option);
    return (
      command.description === GOAL_COMMAND.description &&
      command.default_member_permissions === null &&
      command.nsfw !== true &&
      Array.isArray(command.options) &&
      command.options.length === 1 &&
      request?.name === "request" &&
      request.description === GOAL_COMMAND.options[0].description &&
      request.type === 3 &&
      request.required === true &&
      request.max_length === 4_000
    );
  }

  async acknowledge(
    command: DiscordGoalInteraction,
  ): Promise<{ messageId: string; occurredAt: string }> {
    this.assertCommand(command);
    const callbackUrl = `${this.apiBaseUrl}/interactions/${command.interactionId}/${encodeURIComponent(command.token)}/callback?with_response=true`;
    try {
      const callback = record(
        await postPlatformJson({
          url: callbackUrl,
          headers: {},
          body: {
            type: 4,
            data: { content: "목표를 확인하고 있습니다.", allowed_mentions: { parse: [] } },
          },
          requestTimeoutMs: 2_000,
          ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
          allowInsecureHttpForTests: this.options.allowInsecureHttpForTests === true,
          allowQuery: true,
        }),
      );
      const interaction = record(callback.interaction);
      if (interaction.id !== command.interactionId)
        throw new ConversationPlatformError(
          "platform_delivery_failed",
          "Discord returned another interaction.",
        );
      const resourceMessage = record(callback.resource).message;
      const receipt = messageReceipt(resourceMessage, command.channelId);
      if (interaction.response_message_id !== receipt.messageId)
        throw new ConversationPlatformError(
          "platform_delivery_failed",
          "Discord returned conflicting /goal message IDs.",
        );
      return receipt;
    } catch (error) {
      // An uncertain POST must never be repeated; recover only its original response.
      try {
        const original = await getPlatformJson({
          url: this.originalUrl(command),
          headers: {},
          requestTimeoutMs: 2_000,
          ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
          allowInsecureHttpForTests: this.options.allowInsecureHttpForTests === true,
        });
        return messageReceipt(original, command.channelId);
      } catch {
        throw error;
      }
    }
  }

  async update(
    command: DiscordGoalInteraction,
    expectedMessageId: string,
    content: string,
  ): Promise<void> {
    this.assertCommand(command);
    if (content.length < 1 || [...content].length > 2_000)
      throw new ConversationPlatformError(
        "platform_delivery_failed",
        "The /goal status text is invalid.",
      );
    const response = await patchPlatformJson({
      url: this.originalUrl(command),
      headers: {},
      body: { content, allowed_mentions: { parse: [] } },
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
      allowInsecureHttpForTests: this.options.allowInsecureHttpForTests === true,
    });
    if (messageReceipt(response, command.channelId).messageId !== expectedMessageId)
      throw new ConversationPlatformError(
        "platform_delivery_failed",
        "The /goal response changed identity.",
      );
  }

  private originalUrl(command: DiscordGoalInteraction): string {
    return `${this.apiBaseUrl}/webhooks/${command.applicationId}/${encodeURIComponent(command.token)}/messages/@original`;
  }

  private assertCommand(command: DiscordGoalInteraction): void {
    if (
      command.applicationId !== this.options.applicationId ||
      !this.guilds.has(command.guildId) ||
      !/^[0-9]{1,32}$/u.test(command.channelId)
    )
      throw new ConversationPlatformError(
        "platform_authentication_failed",
        "The /goal interaction is outside the installed app scope.",
      );
  }
}
