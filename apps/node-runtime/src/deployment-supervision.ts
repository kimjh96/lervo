import type { NodeRuntimeConfig } from "./config-types.js";
import type { NodeDiscordConversationRuntime } from "./discord-conversation-runtime-types.js";
import { configuredDiscordConversations } from "./discord-conversation-deployments-config.js";
import type { NodeRuntimeHealthPublisher } from "./health.js";
import { openNodeSupervisionService } from "./supervision-startup.js";

/** Resolves only this Node's bound speaker and target before starting repository supervision. */
export async function openDeploymentSupervision(input: {
  config: NodeRuntimeConfig;
  projectId: string;
  conversation: NodeDiscordConversationRuntime | undefined;
  health: NodeRuntimeHealthPublisher;
}) {
  const configuration = input.config.outcomeSupervision;
  if (configuration === undefined) return null;
  const origin = configuration.resultOrigin;
  if (origin !== undefined) {
    const conversation = configuredDiscordConversations(input.config).find(
      (item) => item.integrationId === origin.target.integrationId,
    );
    if (
      conversation === undefined ||
      conversation.agentId !== configuration.binding.ownerAgentId ||
      conversation.agentParticipantId !== origin.actor.participantId ||
      origin.target.projectId !== input.projectId ||
      !conversation.conversations.some(
        (item) => item.conversationId === origin.target.conversationId,
      )
    )
      throw new Error("Supervision publication is outside the installed owner conversation.");
  }
  const adapter =
    origin === undefined
      ? undefined
      : (input.conversation?.resultAdapter?.(origin.target.integrationId) ?? undefined);
  return openNodeSupervisionService({
    repositoryRoot: input.config.repositoryRoot,
    configuration,
    ...(adapter === undefined ? {} : { deliveryAdapter: adapter }),
    observeHealth: (health) => input.health.observeSupervision(health),
  });
}
