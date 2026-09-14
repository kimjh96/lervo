import type { NodeRuntimeConfig } from "./config-types.js";
import type { NodeDiscordConversationRuntime } from "./discord-conversation-runtime-types.js";
import { configuredDiscordConversations } from "./discord-conversation-deployments-config.js";
import { resolveDiscordAgentParticipation } from "./discord-agent-participation.js";
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
  const ownerConversations = configuredDiscordConversations(input.config).filter(
    (item) => item.agentId === configuration.binding.ownerAgentId,
  );
  if (ownerConversations.length > 1)
    throw new Error("Supervision has multiple configured owner conversation speakers.");
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
      ? ownerConversations.length === 0
        ? undefined
        : (input.conversation?.resultAdapter?.(ownerConversations[0]!.integrationId) ?? undefined)
      : (input.conversation?.resultAdapter?.(origin.target.integrationId) ?? undefined);
  const adapterArtifacts =
    adapter === undefined
      ? undefined
      : (input.conversation?.resultArtifacts?.(adapter.descriptor.integrationId) ?? undefined);
  if (ownerConversations.length === 1 && adapter === undefined)
    throw new Error("The installed owner conversation has no result adapter.");
  if (adapter !== undefined && adapterArtifacts === undefined)
    throw new Error("The installed owner conversation has no result artifact store.");
  if (adapter !== undefined && input.conversation?.resultReplay === undefined)
    throw new Error("The installed owner conversation has no result replay inspection.");
  const ownerParticipation =
    ownerConversations[0] === undefined
      ? null
      : await resolveDiscordAgentParticipation({
          repositoryRoot: input.config.repositoryRoot,
          config: ownerConversations[0],
        });
  if (
    ownerParticipation !== null &&
    ownerParticipation.agentId !== configuration.binding.ownerAgentId
  )
    throw new Error("The installed owner conversation identity changed.");
  if (origin !== undefined && origin.actor.roleId !== ownerParticipation?.roleId)
    throw new Error("The installed result origin differs from the owner's current role.");
  return openNodeSupervisionService({
    repositoryRoot: input.config.repositoryRoot,
    configuration,
    ...(adapter === undefined ? {} : { deliveryAdapter: adapter }),
    ...(adapterArtifacts === undefined ? {} : { deliveryArtifacts: adapterArtifacts }),
    ...(adapter === undefined
      ? {}
      : {
          deliveryReplay: (outboundId: string) =>
            input.conversation!.resultReplay!(adapter.descriptor.integrationId, outboundId),
        }),
    ...(ownerConversations[0] === undefined
      ? {}
      : {
          deliverySpeaker: {
            participantId: ownerConversations[0].agentParticipantId,
            roleId: ownerParticipation!.roleId,
            conversationIds: ownerConversations[0].conversations.map((item) => item.conversationId),
          },
        }),
    observeHealth: (health) => input.health.observeSupervision(health),
  });
}
