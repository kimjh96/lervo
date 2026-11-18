import {
  DiscordConversationAdapter,
  DiscordRestConversationAddress,
  DiscordRestManagedBotRoles,
  DiscordRestDelivery,
  DiscordRestWebhookDelivery,
  DiscordRestTyping,
  type DiscordDeliveryPort,
} from "@lervo/adapter-discord";

import type { ConversationApplicationOptions, DiscordConversationDeployment } from "./types.js";
import type {
  ConversationIntegrationContext,
  ConversationIntegrationDeployment,
} from "./integration.js";

function discordIntegration(
  deployment: DiscordConversationDeployment,
  gatewayAuthentication: NonNullable<DiscordConversationDeployment["gatewayAuthentication"]>,
  parentChannelIds: readonly string[],
): ConversationIntegrationDeployment {
  return {
    integrationId: deployment.integrationId,
    platform: "discord",
    create: (context: ConversationIntegrationContext) => {
      const transportOptions = {
        integrationId: deployment.integrationId,
        replay: context.deliveryReplay,
        ...(context.now === undefined ? {} : { now: context.now }),
        ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
        ...(deployment.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: deployment.requestTimeoutMs }),
        ...(deployment.maxResponseBytes === undefined
          ? {}
          : { maxResponseBytes: deployment.maxResponseBytes }),
      };
      let delivery: DiscordDeliveryPort;
      if (deployment.delivery?.kind === "webhook") {
        const webhookDelivery = deployment.delivery;
        const deliveries = new Map(
          webhookDelivery.webhooks.map((webhook) => [
            webhook.parentChannelId,
            new DiscordRestWebhookDelivery({
              ...transportOptions,
              ...webhook,
              username: webhookDelivery.username,
              ...(webhookDelivery.avatarUrl === undefined
                ? {}
                : { avatarUrl: webhookDelivery.avatarUrl }),
            }),
          ]),
        );
        delivery = {
          send(input) {
            const target = deliveries.get(input.channelId);
            if (target === undefined) {
              throw new Error("No Discord webhook is bound to the outbound channel.");
            }
            return target.send(input);
          },
        };
      } else {
        delivery = new DiscordRestDelivery({ ...transportOptions, botToken: deployment.botToken });
      }
      const typing =
        deployment.delivery?.kind === "webhook"
          ? undefined
          : new DiscordRestTyping({
              botToken: deployment.botToken,
              ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
              ...(deployment.requestTimeoutMs === undefined
                ? {}
                : { requestTimeoutMs: deployment.requestTimeoutMs }),
            });
      const conversationAddress = new DiscordRestConversationAddress({
        botToken: deployment.botToken,
        allowedGuildIds: deployment.allowedGuildIds,
        parentChannelIds,
        ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
        ...(deployment.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: deployment.requestTimeoutMs }),
        ...(deployment.maxResponseBytes === undefined
          ? {}
          : { maxResponseBytes: deployment.maxResponseBytes }),
      });
      const managedBotRoles = new DiscordRestManagedBotRoles({
        botToken: deployment.botToken,
        allowedGuildIds: deployment.allowedGuildIds,
        ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
        ...(deployment.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: deployment.requestTimeoutMs }),
        ...(deployment.maxResponseBytes === undefined
          ? {}
          : { maxResponseBytes: deployment.maxResponseBytes }),
      });
      return new DiscordConversationAdapter({
        integrationId: deployment.integrationId,
        applicationId: deployment.applicationId,
        allowedGuildIds: deployment.allowedGuildIds,
        allowDirectMessages: deployment.allowDirectMessages,
        gatewayAuthentication,
        identity: context.identity,
        artifactStore: context.artifactStore,
        delivery,
        conversationAddress,
        managedBotRoles,
        deliveryIdentity:
          deployment.delivery?.kind === "webhook"
            ? `webhooks:${deployment.delivery.webhooks
                .map((webhook) => webhook.webhookId)
                .sort()
                .join(",")}`
            : deployment.applicationId,
        ignoredParticipantKeys:
          deployment.delivery?.kind === "webhook"
            ? deployment.delivery.webhooks.map((webhook) => `webhook:${webhook.webhookId}`)
            : [`bot:${deployment.applicationId}`],
        ...(deployment.textualParticipantAliases === undefined
          ? {}
          : { textualParticipantAliases: deployment.textualParticipantAliases }),
        ...(typing === undefined ? {} : { typing }),
        ...(context.now === undefined ? {} : { now: context.now }),
      });
    },
  };
}

export function configuredConversationIntegrations(
  options: ConversationApplicationOptions,
  discordGatewayAuthentications: ReadonlyMap<
    string,
    NonNullable<DiscordConversationDeployment["gatewayAuthentication"]>
  > = new Map(),
): ConversationIntegrationDeployment[] {
  return [
    ...(options.discord ?? []).map((deployment) => {
      const authentication =
        discordGatewayAuthentications.get(deployment.integrationId) ??
        deployment.gatewayAuthentication;
      if (authentication === undefined) {
        throw new Error("A Discord integration requires one Gateway authentication owner.");
      }
      return discordIntegration(
        deployment,
        authentication,
        options.conversations
          .filter(
            (binding) =>
              binding.platform === "discord" && binding.integrationId === deployment.integrationId,
          )
          .map((binding) => binding.conversationKey),
      );
    }),
    ...(options.integrations ?? []),
  ];
}
