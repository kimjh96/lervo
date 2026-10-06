import { resolve } from "node:path";

import type { ProjectManifest } from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import type { ConversationOperationDrain } from "@lervo/conversation-app";

import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";
import type { NodeDiscordConversationRuntimeOptions } from "./discord-conversation-runtime-types.js";
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
import { createCoResidentDiscordPeerAgents } from "./discord-conversation-co-resident-peers.js";
import { SQLiteConversationTurnFocusStore } from "./conversation-turn-focus-store.js";
import { CoResidentConversationPeerTurnRouter } from "./conversation-peer-turn-router.js";
import { CoResidentConversationDeliberationParticipants } from "./conversation-deliberation-participant-router.js";
import { resolveDiscordUnaddressedPriorities } from "./discord-conversation-priorities.js";
import { assertProductOwnerSupervisionPolicy } from "./product-owner-supervision-policy.js";
import type { NodeRuntimeDeferredWork } from "./startup-deferred-work.js";

function boundedErrorCoordinates(error: unknown): string {
  const coordinates: Array<{ name: string; code: string | null }> = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const record = current as { name?: unknown; code?: unknown; cause?: unknown };
    coordinates.push({
      name:
        typeof record.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(record.name)
          ? record.name
          : "Error",
      code:
        typeof record.code === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(record.code)
          ? record.code
          : null,
    });
    if (coordinates.length >= 6) break;
    current = record.cause;
  }
  return JSON.stringify(coordinates);
}

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
  snapshotWorkerEntry?: string;
  /** ADR-0480: receives cache warm-ups that must not delay Node readiness. */
  deferredWork?: Pick<NodeRuntimeDeferredWork, "schedule">;
  dataDirectory: string;
  operationDrain?: ConversationOperationDrain;
  runtimeConfigPath?: string;
  bearerToken(): string;
  repositoryArtifacts: ArtifactStore;
  repositoryEvents: Pick<EventStore, "latest" | "list"> & { readonly path?: string };
  legacyPorts: NodeRuntimeOpenPorts["discordConversation"];
  deploymentPorts: NodeRuntimeOpenPorts["discordConversations"];
  supervisionControl?: NodeDiscordConversationRuntimeOptions["supervisionControl"];
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
  assertProductOwnerSupervisionPolicy({
    config: input.config,
    deployments: configs,
    participations,
  });
  const providerExecutables = input.config.remoteCommands?.providerHost?.executables;
  const providerModels = input.config.remoteCommands?.providerHost?.models;
  const providerReasoningEfforts = input.config.remoteCommands?.providerHost?.reasoningEfforts;
  const providerExecutionProfiles = input.config.remoteCommands?.providerHost?.executionProfiles;
  const managedRepositoryResources = createManagedConversationRepositoryResources({
    ...(input.snapshotWorkerEntry === undefined
      ? {}
      : { snapshotWorkerEntry: input.snapshotWorkerEntry }),
    ...(input.deferredWork === undefined ? {} : { deferredWork: input.deferredWork }),
  });
  const turnFocusStore = await SQLiteConversationTurnFocusStore.open(
    resolve(input.dataDirectory, "conversation", "turn-focus.sqlite"),
  );
  const peerTurnRouter = new CoResidentConversationPeerTurnRouter();
  const deliberationParticipants = new CoResidentConversationDeliberationParticipants({
    events: input.repositoryEvents,
  });
  for (const [index, config] of configs.entries()) {
    if (config.deliberationParticipation !== undefined) {
      deliberationParticipants.register({ config, participation: participations[index]! });
    }
  }
  const unaddressedPriorities = resolveDiscordUnaddressedPriorities(configs);
  const ready = new Set<string>();
  let readyPublished = false;
  let failureObserved = false;
  const runtimes: NodeDiscordConversationRuntime[] = [];
  try {
    for (const [index, conversation] of configs.entries()) {
      const integrationPorts = ports.get(conversation.integrationId) ?? {};
      const peerAgents = createCoResidentDiscordPeerAgents({
        configs,
        participations,
        currentIndex: index,
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
          ...(input.config.outcomeSupervision === undefined
            ? {}
            : { outcomeSupervision: input.config.outcomeSupervision }),
          ...(input.supervisionControl === undefined
            ? {}
            : { supervisionControl: input.supervisionControl }),
          ...(input.config.repositoryReplica === undefined
            ? {}
            : { repositoryReplica: input.config.repositoryReplica }),
          dataDirectory: resolve(input.dataDirectory, "conversation", conversation.integrationId),
          ...(input.operationDrain === undefined ? {} : { operationDrain: input.operationDrain }),
          ...(input.runtimeConfigPath === undefined
            ? {}
            : { runtimeConfigPath: input.runtimeConfigPath }),
          bearerToken: input.bearerToken,
          repositoryArtifactStore: input.repositoryArtifacts,
          repositoryEvents: input.repositoryEvents,
          managedRepositoryResources,
          ...(providerExecutables === undefined ? {} : { providerExecutables }),
          ...(providerModels === undefined ? {} : { providerModels }),
          ...(providerReasoningEfforts === undefined ? {} : { providerReasoningEfforts }),
          ...(providerExecutionProfiles === undefined ? {} : { providerExecutionProfiles }),
          agentParticipation: participations[index]!,
          peerAgents,
          peerTurnRouter,
          deliberationParticipants,
          unaddressedPriorities,
          turnFocusStore,
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
            process.stderr.write(
              `Lervo Discord conversation runtime failed (${conversation.integrationId}:${code}).\n`,
            );
            await input.onFailure(code);
          },
          onError: (error) => {
            process.stderr.write(
              `Lervo Discord conversation error (${conversation.integrationId}): ${boundedErrorCoordinates(error)}.\n`,
            );
          },
        }),
      );
    }
    return groupDiscordConversationRuntimes(runtimes, () => turnFocusStore.close());
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
    turnFocusStore.close();
    throw error;
  }
}
