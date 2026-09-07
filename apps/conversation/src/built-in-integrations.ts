import {
  DiscordConversationAdapter,
  DiscordRestDelivery,
  DiscordRestTyping,
} from "@lervo/adapter-discord";
import { SlackConversationAdapter, SlackWebApiDelivery } from "@lervo/adapter-slack";

import type {
  ConversationApplicationOptions,
  DiscordConversationDeployment,
  SlackConversationDeployment,
} from "./types.js";
import type {
  ConversationIntegrationContext,
  ConversationIntegrationDeployment,
} from "./integration.js";

function slackIntegration(
  deployment: SlackConversationDeployment,
): ConversationIntegrationDeployment {
  return {
    integrationId: deployment.integrationId,
    platform: "slack",
    create: (context: ConversationIntegrationContext) => {
      const delivery = new SlackWebApiDelivery({
        integrationId: deployment.integrationId,
        botToken: deployment.botToken,
        replay: context.deliveryReplay,
        ...(context.now === undefined ? {} : { now: context.now }),
        ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
        ...(deployment.requestTimeoutMs === undefined
          ? {}
          : {
              requestTimeoutMs: deployment.requestTimeoutMs,
            }),
        ...(deployment.maxResponseBytes === undefined
          ? {}
          : {
              maxResponseBytes: deployment.maxResponseBytes,
            }),
      });
      return new SlackConversationAdapter({
        integrationId: deployment.integrationId,
        apiAppId: deployment.apiAppId,
        allowedTeamIds: deployment.allowedTeamIds,
        signingSecret: deployment.signingSecret,
        identity: context.identity,
        artifactStore: context.artifactStore,
        delivery,
        ...(context.now === undefined ? {} : { now: context.now }),
      });
    },
  };
}

function discordIntegration(
  deployment: DiscordConversationDeployment,
  gatewayAuthentication: NonNullable<DiscordConversationDeployment["gatewayAuthentication"]>,
): ConversationIntegrationDeployment {
  return {
    integrationId: deployment.integrationId,
    platform: "discord",
    create: (context: ConversationIntegrationContext) => {
      const delivery = new DiscordRestDelivery({
        integrationId: deployment.integrationId,
        botToken: deployment.botToken,
        replay: context.deliveryReplay,
        ...(context.now === undefined ? {} : { now: context.now }),
        ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
        ...(deployment.requestTimeoutMs === undefined
          ? {}
          : {
              requestTimeoutMs: deployment.requestTimeoutMs,
            }),
        ...(deployment.maxResponseBytes === undefined
          ? {}
          : {
              maxResponseBytes: deployment.maxResponseBytes,
            }),
      });
      const typing = new DiscordRestTyping({
        botToken: deployment.botToken,
        ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
        ...(deployment.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: deployment.requestTimeoutMs }),
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
        typing,
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
    ...(options.slack ?? []).map(slackIntegration),
    ...(options.discord ?? []).map((deployment) => {
      const authentication =
        discordGatewayAuthentications.get(deployment.integrationId) ??
        deployment.gatewayAuthentication;
      if (authentication === undefined) {
        throw new Error("A Discord integration requires one Gateway authentication owner.");
      }
      return discordIntegration(deployment, authentication);
    }),
    ...(options.integrations ?? []),
  ];
}
