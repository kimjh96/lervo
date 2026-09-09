import { createHash } from "node:crypto";

import type {
  OrganizationExecutiveEffect,
  OrganizationExecutiveEffectPort,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import { PlatformDeliveryRejectedError } from "@lervo/conversation-platform";

import type { DiscordAdministrationPort } from "./types.js";

export interface DiscordWebhookCredentialSink {
  store(input: {
    effectId: string;
    webhookId: string;
    token: string;
  }): Promise<{ credentialReferenceHash: string }>;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("The Discord organization effect parameters are invalid.");
  }
  return value as Record<string, unknown>;
}

function resultHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function requiredString(parameters: Record<string, unknown>, key: string): string {
  const value = parameters[key];
  if (typeof value !== "string") {
    throw new TypeError(`The Discord organization effect ${key} parameter is invalid.`);
  }
  return value;
}

function nullableString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`The Discord organization effect ${key} parameter is invalid.`);
  }
  return value;
}

export class DiscordOrganizationExecutiveEffectAdapter implements OrganizationExecutiveEffectPort {
  readonly adapterId = "discord_administration_v1";
  readonly actions: readonly OrganizationExecutiveEffect["action"][];

  constructor(
    private readonly administration: DiscordAdministrationPort,
    private readonly webhookCredentials?: DiscordWebhookCredentialSink,
  ) {
    this.actions = [
      "conversation.channel.create",
      "conversation.thread.create",
      ...(webhookCredentials === undefined ? [] : (["agent.deployment.prepare"] as const)),
    ];
  }

  async apply(effect: Readonly<OrganizationExecutiveEffect>) {
    try {
      const parameters = record(effect.parameters);
      if (effect.action === "conversation.channel.create") {
        const result = await this.administration.createGuildTextChannel({
          guildId: requiredString(parameters, "guildId"),
          name: requiredString(parameters, "name"),
          topic: nullableString(parameters, "topic"),
          parentChannelId: nullableString(parameters, "parentChannelId"),
        });
        return {
          status: "completed" as const,
          externalEffectId: result.channelId,
          resultHash: resultHash(result),
          completedAt: result.observedAt,
        };
      }
      if (effect.action === "conversation.thread.create") {
        const result = await this.administration.createPublicThread({
          guildId: requiredString(parameters, "guildId"),
          channelId: requiredString(parameters, "channelId"),
          name: requiredString(parameters, "name"),
          autoArchiveDuration: parameters.autoArchiveDuration as 60 | 1440 | 4320 | 10080,
        });
        return {
          status: "completed" as const,
          externalEffectId: result.threadId,
          resultHash: resultHash(result),
          completedAt: result.observedAt,
        };
      }
      if (effect.action === "agent.deployment.prepare" && this.webhookCredentials !== undefined) {
        const agentId = requiredString(parameters, "agentId");
        if (!/^agt_[a-f0-9]{24}$/u.test(agentId)) {
          throw new TypeError("The Discord organization effect agentId parameter is invalid.");
        }
        const result = await this.administration.createIncomingWebhook({
          guildId: requiredString(parameters, "guildId"),
          channelId: requiredString(parameters, "channelId"),
          name: requiredString(parameters, "name"),
        });
        const stored = await this.webhookCredentials.store({
          effectId: effect.effectId,
          webhookId: result.webhookId,
          token: result.token,
        });
        return {
          status: "completed" as const,
          externalEffectId: result.webhookId,
          resultHash: resultHash({
            agentId,
            guildId: result.guildId,
            channelId: result.channelId,
            webhookId: result.webhookId,
            name: result.name,
            credentialReferenceHash: stored.credentialReferenceHash,
            observedAt: result.observedAt,
          }),
          completedAt: result.observedAt,
        };
      }
      return { status: "rejected" as const, reasonCode: "action_not_supported" };
    } catch (error) {
      if (error instanceof PlatformDeliveryRejectedError) {
        return { status: "rejected" as const, reasonCode: "platform_rejected" };
      }
      throw error;
    }
  }
}
