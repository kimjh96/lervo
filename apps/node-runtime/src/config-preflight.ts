import type { NodeRuntimeConfig } from "./config-types.js";
import { loadNodeBearerToken } from "./credentials.js";
import { loadDiscordBotToken } from "./discord-credentials.js";
import { configuredDiscordConversations } from "./discord-conversation-deployments-config.js";
import { resolveDiscordAgentParticipation } from "./discord-agent-participation.js";
import { assertProductOwnerSupervisionPolicy } from "./product-owner-supervision-policy.js";

export async function preflightNodeRuntimeCredentials(config: NodeRuntimeConfig): Promise<void> {
  const deployments = configuredDiscordConversations(config);
  await Promise.all([
    loadNodeBearerToken(config.hub.bearerTokenFile),
    ...deployments.map((conversation) =>
      loadDiscordBotToken(conversation.botTokenFile).then(() => undefined),
    ),
    ...deployments.flatMap((conversation) =>
      conversation.speaker?.kind === "webhook"
        ? conversation.speaker.webhooks.map((webhook) =>
            loadDiscordBotToken(webhook.tokenFile).then(() => undefined),
          )
        : [],
    ),
  ]);
  const participations = await Promise.all(
    deployments.map((deployment) =>
      resolveDiscordAgentParticipation({
        repositoryRoot: config.repositoryRoot,
        config: deployment,
      }),
    ),
  );
  assertProductOwnerSupervisionPolicy({ config, deployments, participations });
}
