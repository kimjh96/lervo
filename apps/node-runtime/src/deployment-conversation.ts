import { resolve } from "node:path";

import type { ProjectManifest } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";
import { configuredDiscordConversations } from "./discord-conversation-deployments-config.js";
import { groupDiscordConversationRuntimes } from "./discord-conversation-group-runtime.js";
import {
  openNodeDiscordConversationRuntime,
  type NodeDiscordConversationRuntime,
} from "./discord-conversation-runtime.js";
import { resolveDiscordAgentParticipation } from "./discord-agent-participation.js";
import { NodeRuntimeError } from "./errors.js";
import type { NodeDiscordConversationOpenPorts, NodeRuntimeOpenPorts } from "./open-ports.js";
import { createManagedConversationRepositoryResources } from "./conversation-read-responder.js";
import { discordSpeakerParticipantKeys } from "./discord-conversation-speaker.js";

function selectPorts(
  configs: NodeDiscordConversationConfig[],
  legacy: NodeDiscordConversationOpenPorts | undefined,
  deployments: NodeRuntimeOpenPorts["discordConversations"],
): Map<string, NodeDiscordConversationOpenPorts> {
  if (legacy !== undefined && deployments !== undefined) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Use either legacy or per-deployment Discord conversation ports, not both.",
    );
  }
  if (legacy !== undefined) {
    if (configs.length !== 1) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Legacy Discord conversation ports require exactly one deployment.",
      );
    }
    return new Map([[configs[0]!.integrationId, legacy]]);
  }
  if (deployments === undefined) return new Map();
  const integrationIds = new Set(configs.map((config) => config.integrationId));
  if (Object.keys(deployments).some((integrationId) => !integrationIds.has(integrationId))) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Per-deployment Discord ports must name configured integration IDs.",
    );
  }
  return new Map(Object.entries(deployments));
}

export async function openDeploymentConversation(input: {
  config: NodeRuntimeConfig;
  project: ProjectManifest;
  projectIdentityHash: string;
  repositoryRoot: string;
  dataDirectory: string;
  bearerToken(): string;
  repositoryEvents: Pick<EventStore, "latest" | "list">;
  legacyPorts: NodeRuntimeOpenPorts["discordConversation"];
  deploymentPorts: NodeRuntimeOpenPorts["discordConversations"];
  onReady(): void | Promise<void>;
  onFailure(code: string): void | Promise<void>;
}): Promise<NodeDiscordConversationRuntime | undefined> {
  const configs = configuredDiscordConversations(input.config);
  if (configs.length === 0) {
    if (input.legacyPorts !== undefined || input.deploymentPorts !== undefined) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Discord conversation ports require Discord conversation configuration.",
      );
    }
    return undefined;
  }
  const ports = selectPorts(configs, input.legacyPorts, input.deploymentPorts);
  const participations = await Promise.all(
    configs.map((config) =>
      resolveDiscordAgentParticipation({ repositoryRoot: input.repositoryRoot, config }),
    ),
  );
  const providerExecutables = input.config.remoteCommands?.providerHost?.executables;
  const managedRepositoryResources = createManagedConversationRepositoryResources();
  const ready = new Set<string>();
  let readyPublished = false;
  let failureObserved = false;
  const runtimes: NodeDiscordConversationRuntime[] = [];
  try {
    for (const [index, conversation] of configs.entries()) {
      const integrationPorts = ports.get(conversation.integrationId) ?? {};
      const peerAgents = configs.flatMap((peer, peerIndex) => {
        if (peerIndex === index) return [];
        return [
          {
            participantKeys: discordSpeakerParticipantKeys(peer),
            participantId: peer.agentParticipantId,
            roleId: participations[peerIndex]!.roleId,
            agentBinding: participations[peerIndex]!.agentBinding!,
            tenantKeys: conversation.allowedGuildIds.filter((tenant) =>
              peer.allowedGuildIds.includes(tenant),
            ),
            conversationIds: peer.conversations.flatMap((peerBinding) =>
              conversation.conversations.some(
                (binding) =>
                  binding.tenantKey === peerBinding.tenantKey &&
                  binding.conversationKey === peerBinding.conversationKey &&
                  binding.conversationId === peerBinding.conversationId,
              )
                ? [peerBinding.conversationId]
                : [],
            ),
          },
        ];
      });
      runtimes.push(
        await openNodeDiscordConversationRuntime({
          config: conversation,
          hub: input.config.hub,
          project: {
            projectId: input.project.projectId,
            projectIdentityHash: input.projectIdentityHash,
            createdAt: input.project.createdAt,
          },
          repositoryRoot: input.repositoryRoot,
          dataDirectory: resolve(input.dataDirectory, "conversation", conversation.integrationId),
          bearerToken: input.bearerToken,
          repositoryEvents: input.repositoryEvents,
          managedRepositoryResources,
          ...(providerExecutables === undefined ? {} : { providerExecutables }),
          agentParticipation: participations[index]!,
          peerAgents,
          ...integrationPorts,
          onReady: async () => {
            ready.add(conversation.integrationId);
            if (!readyPublished && ready.size === configs.length) {
              readyPublished = true;
              await input.onReady();
            }
          },
          onFailure: async (code) => {
            if (failureObserved) return;
            failureObserved = true;
            await input.onFailure(code);
          },
        }),
      );
    }
    return groupDiscordConversationRuntimes(runtimes);
  } catch (error) {
    if (runtimes.length > 0) {
      try {
        await groupDiscordConversationRuntimes(runtimes).close();
      } catch (cleanupError) {
        throw new NodeRuntimeError(
          "startup_failed",
          "Could not close every Discord conversation after startup failed.",
          { cause: new AggregateError([error, cleanupError]) },
        );
      }
    }
    throw error;
  }
}
