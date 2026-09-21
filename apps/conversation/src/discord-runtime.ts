import type {
  DiscordGatewayAuthenticationPort,
  DiscordGatewayDispatch,
  DiscordHistoryPort,
} from "@lervo/adapter-discord";
import { DiscordRestHistory } from "@lervo/adapter-discord";
import {
  AuthenticatedDiscordGatewayDriver,
  includesDiscordGatewayIntents,
  requiredDiscordConversationIntents,
} from "@lervo/discord-gateway";

import type { DiscordConversationDeployment } from "./types.js";

export class ConversationDiscordGatewayRuntime {
  readonly authentications: ReadonlyMap<string, DiscordGatewayAuthenticationPort>;
  readonly gateways: ReadonlyMap<string, AuthenticatedDiscordGatewayDriver>;
  readonly histories: ReadonlyMap<string, DiscordHistoryPort>;

  constructor(
    deployments: readonly DiscordConversationDeployment[],
    onDispatch: (integrationId: string, dispatch: DiscordGatewayDispatch) => Promise<void>,
    onReady: (integrationId: string) => Promise<void>,
    fetch?: typeof globalThis.fetch,
  ) {
    const authentications = new Map<string, DiscordGatewayAuthenticationPort>();
    const gateways = new Map<string, AuthenticatedDiscordGatewayDriver>();
    const histories = new Map<string, DiscordHistoryPort>();
    for (const deployment of deployments) {
      if ((deployment.gateway === undefined) === (deployment.gatewayAuthentication === undefined)) {
        throw new Error(
          "A Discord integration requires exactly one managed Gateway or authentication port.",
        );
      }
      if (deployment.gatewayAuthentication !== undefined) {
        authentications.set(deployment.integrationId, deployment.gatewayAuthentication);
        continue;
      }
      const gatewayOptions = deployment.gateway!;
      if (
        !includesDiscordGatewayIntents(
          gatewayOptions.intents,
          requiredDiscordConversationIntents({
            guildMessages: deployment.allowedGuildIds.length > 0,
            directMessages: deployment.allowDirectMessages,
          }),
        )
      ) {
        throw new Error(
          "A managed Discord Gateway requires the message intents for its configured scope.",
        );
      }
      const gateway = new AuthenticatedDiscordGatewayDriver({
        ...gatewayOptions,
        applicationId: deployment.applicationId,
        botToken: deployment.botToken,
        onDispatch: (dispatch) => onDispatch(deployment.integrationId, dispatch),
        onReady: async () => {
          await gatewayOptions.onReady?.();
          await onReady(deployment.integrationId);
        },
      });
      histories.set(
        deployment.integrationId,
        new DiscordRestHistory({
          botToken: deployment.botToken,
          ...(deployment.requestTimeoutMs === undefined
            ? {}
            : { requestTimeoutMs: deployment.requestTimeoutMs }),
          ...(deployment.maxResponseBytes === undefined
            ? {}
            : { maxResponseBytes: deployment.maxResponseBytes }),
          ...(fetch === undefined ? {} : { fetch }),
        }),
      );
      authentications.set(deployment.integrationId, gateway);
      gateways.set(deployment.integrationId, gateway);
    }
    this.authentications = authentications;
    this.gateways = gateways;
    this.histories = histories;
  }

  start(): void {
    for (const gateway of this.gateways.values()) gateway.start();
  }

  stop(): void {
    for (const gateway of this.gateways.values()) gateway.stop();
  }
}
