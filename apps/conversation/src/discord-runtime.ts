import type {
  DiscordGatewayAuthenticationPort,
  DiscordGatewayDispatch,
} from "@lervo/adapter-discord";
import {
  AuthenticatedDiscordGatewayDriver,
  includesDiscordGatewayIntents,
  requiredDiscordConversationIntents,
} from "@lervo/discord-gateway";

import type { DiscordConversationDeployment } from "./types.js";

export class ConversationDiscordGatewayRuntime {
  readonly authentications: ReadonlyMap<string, DiscordGatewayAuthenticationPort>;
  readonly gateways: ReadonlyMap<string, AuthenticatedDiscordGatewayDriver>;

  constructor(
    deployments: readonly DiscordConversationDeployment[],
    onDispatch: (integrationId: string, dispatch: DiscordGatewayDispatch) => Promise<void>,
  ) {
    const authentications = new Map<string, DiscordGatewayAuthenticationPort>();
    const gateways = new Map<string, AuthenticatedDiscordGatewayDriver>();
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
      });
      authentications.set(deployment.integrationId, gateway);
      gateways.set(deployment.integrationId, gateway);
    }
    this.authentications = authentications;
    this.gateways = gateways;
  }

  start(): void {
    for (const gateway of this.gateways.values()) gateway.start();
  }

  stop(): void {
    for (const gateway of this.gateways.values()) gateway.stop();
  }
}
