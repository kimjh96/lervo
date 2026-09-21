import { DiscordRestAdministration } from "@lervo/adapter-discord";
import type { ManagedConversationSurfaceEffect } from "@lervo/conversation-responder";
import type { ConversationResponder } from "@lervo/interaction";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { ConversationInboundEvent } from "@lervo/schemas";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import { ConversationTaskDelegateResponder } from "./conversation-task-delegate-responder.js";
import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";
import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";
import { ConversationPlatformActionRouter } from "./conversation-platform-action-router.js";
import {
  ConversationWorkforceActionResponder,
  RepositoryConversationWorkforceHiring,
} from "./conversation-workforce-action-responder.js";
import { DiscordConversationAdministrationResponder } from "./discord-platform-action-responder.js";
import type { SQLiteConversationRepositoryWorkStore } from "./conversation-repository-work-store.js";
import { RepositoryDiscordAgentOrganizationDeployment } from "./discord-agent-organization-deployment.js";
import { DiscordHiredAgentDeployment } from "./discord-hired-agent-deployment.js";
import { discordWorkforceExecution } from "./discord-workforce-execution.js";
import type { ConversationPeerTurnDispatcher } from "./conversation-peer-turn-router.js";
import {
  ConversationRequestedRuntimeManager,
  type ConversationRequestedRuntimeProcessPort,
} from "./conversation-requested-runtime.js";
import { ConversationRequestedRuntimeResponder } from "./conversation-requested-runtime-responder.js";
import { NodeConversationRequestedRuntimeProcess } from "./node-requested-runtime-process.js";

export function discordDelegationSurfaceEffect(
  peers: readonly DiscordPeerAgentBinding[],
): ManagedConversationSurfaceEffect {
  return {
    effectId: "workforce_task_delegate",
    description:
      "Ask exactly one routable peer to perform a bounded subtask from that agent's own durable role, context, and session. Choose this when the peer's responsibility or knowledge makes delegation useful; the coordinator remains responsible for the person's complete outcome.",
    argumentDescription:
      "Compact JSON with exactly participantId and task. participantId must exactly equal one argumentChoices value. Task is the natural bounded subtask for that peer, not a synthetic persona or a copy of unrelated coordinator work.",
    argumentChoices: peers
      .map((peer) => ({
        value: peer.participantId,
        label: `${peer.displayName ?? peer.roleId} (${peer.roleId})`,
      }))
      .sort((left, right) => left.value.localeCompare(right.value)),
    maximumArgumentCharacters: 1_024,
  };
}

export function createDiscordConversationEffects(input: {
  config: NodeDiscordConversationConfig;
  botToken: string;
  artifactStore: ArtifactStore;
  repositoryRoot: string;
  parentAgentId: string | null;
  parentRoleId: string;
  repositoryWorkStore?: SQLiteConversationRepositoryWorkStore;
  runtimeConfigPath?: string;
  onDeploymentPrepared?(sourceEventId: string): void;
  delegation?: {
    parentParticipantId: string;
    parentAgentBinding?: ConversationInboundEvent["actor"]["agentBinding"];
    peers: readonly DiscordPeerAgentBinding[];
    dispatcher: ConversationPeerTurnDispatcher;
  };
  deliberation?: {
    effect: ManagedConversationSurfaceEffect;
    responder: DiscordPlatformActionResponder;
  };
  fetch?: typeof globalThis.fetch;
  requestedRuntimeProcesses?: ConversationRequestedRuntimeProcessPort;
  resultResponder: ConversationResponder;
}): {
  surfaceEffects: ManagedConversationSurfaceEffect[];
  platformAction: DiscordPlatformActionResponder;
  close(): Promise<void>;
} {
  const allowedActions = input.config.administration?.allowedActions ?? [];
  const surfaceEffects: ManagedConversationSurfaceEffect[] = [
    ...(allowedActions.includes("current_member.nickname.set")
      ? [
          {
            effectId: "discord_current_member_nickname_set",
            description: "Change this agent's nickname in the current Discord server.",
            argumentDescription: "The intended nickname.",
            maximumArgumentCharacters: 32,
          },
        ]
      : []),
    ...(allowedActions.includes("guild_text_channel.create")
      ? [
          {
            effectId: "discord_guild_text_channel_create",
            description: "Create a text channel in the current Discord server.",
            argumentDescription:
              "The lowercase Discord channel name using letters, numbers, hyphens, or underscores.",
            maximumArgumentCharacters: 100,
          },
        ]
      : []),
    ...(allowedActions.includes("public_thread.create")
      ? [
          {
            effectId: "discord_public_thread_create",
            description: "Create a public thread under the current Discord channel.",
            argumentDescription: "The intended thread name.",
            maximumArgumentCharacters: 100,
          },
        ]
      : []),
    ...(allowedActions.includes("workforce.agent.hire")
      ? [
          {
            effectId: "workforce_agent_hire",
            description:
              "Hire one child agent in this authorized parent's repository scope with inherited capability limits.",
            argumentDescription:
              "Compact JSON with exactly name, roleId, and provider (codex, claude, or any).",
            maximumArgumentCharacters: 512,
          },
        ]
      : []),
    ...(input.delegation === undefined
      ? []
      : [discordDelegationSurfaceEffect(input.delegation.peers)]),
    ...(input.deliberation === undefined ? [] : [input.deliberation.effect]),
    ...(allowedActions.includes("requested_runtime.manage")
      ? [
          {
            effectId: "requested_runtime_open",
            description:
              "Start one configured on-demand runtime for the current request. It remains owned by this Node only until explicit close, maximum lifetime, or Node shutdown; it is never enabled at boot or unconditionally restarted.",
            argumentDescription: "The exact configured runtimeId.",
            argumentChoices: input.config.requestedRuntimes!.map((target) => ({
              value: target.runtimeId,
              label: target.displayName,
            })),
            maximumArgumentCharacters: 64,
          },
          {
            effectId: "requested_runtime_close",
            description:
              "Stop one configured on-demand runtime that was opened for a request on this Node.",
            argumentDescription: "The exact configured runtimeId.",
            argumentChoices: input.config.requestedRuntimes!.map((target) => ({
              value: target.runtimeId,
              label: target.displayName,
            })),
            maximumArgumentCharacters: 64,
          },
        ]
      : []),
  ];
  const administration = new DiscordRestAdministration({
    applicationId: input.config.applicationId,
    botToken: input.botToken,
    allowedGuildIds: input.config.allowedGuildIds,
    allowedChannelIds: input.config.conversations.map((item) => item.conversationKey),
    ...(input.config.http?.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: input.config.http.requestTimeoutMs }),
    ...(input.config.http?.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: input.config.http.maxResponseBytes }),
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
  const discord = new DiscordConversationAdministrationResponder({
    artifactStore: input.artifactStore,
    administration,
    conversations: input.config.conversations.map((binding) => ({
      conversationId: binding.conversationId,
      guildId: binding.tenantKey,
      channelId: binding.conversationKey,
    })),
    allowNicknameUpdate: allowedActions.includes("current_member.nickname.set"),
    allowGuildTextChannelCreate: allowedActions.includes("guild_text_channel.create"),
    allowPublicThreadCreate: allowedActions.includes("public_thread.create"),
  });
  const workforce = allowedActions.includes("workforce.agent.hire")
    ? new ConversationWorkforceActionResponder({
        artifactStore: input.artifactStore,
        parentAgentId: input.parentAgentId!,
        ...(input.delegation === undefined
          ? {}
          : { existingConversationAgents: input.delegation.peers }),
        hiring: new RepositoryConversationWorkforceHiring(input.repositoryRoot),
        ...(discordWorkforceExecution(input.config, input.runtimeConfigPath) !==
        "separate_deployment"
          ? {}
          : {
              deployment: new DiscordHiredAgentDeployment({
                configPath: input.runtimeConfigPath!,
                parentIntegrationId: input.config.integrationId,
                administration,
                organization: new RepositoryDiscordAgentOrganizationDeployment(
                  input.repositoryRoot,
                ),
              }),
            }),
        ...(input.onDeploymentPrepared === undefined
          ? {}
          : { onDeploymentPrepared: input.onDeploymentPrepared }),
        ...(input.repositoryWorkStore === undefined
          ? {}
          : {
              onConversationDelegateHired: ({ conversationId, threadId, agent, hiredAt }) =>
                input.repositoryWorkStore!.activateDelegate({
                  conversationId,
                  threadId,
                  delegate: {
                    agentId: agent.agentId,
                    displayName: agent.displayName,
                    roleId: agent.roleId,
                    provider: agent.provider,
                  },
                  activatedAt: hiredAt,
                }),
            }),
      })
    : undefined;
  const delegate =
    input.delegation === undefined
      ? undefined
      : new ConversationTaskDelegateResponder({
          artifactStore: input.artifactStore,
          parentRoleId: input.parentRoleId,
          ...input.delegation,
        });
  const requestedRuntimeManager = allowedActions.includes("requested_runtime.manage")
    ? new ConversationRequestedRuntimeManager(
        input.config.requestedRuntimes!,
        input.requestedRuntimeProcesses ?? new NodeConversationRequestedRuntimeProcess(input.fetch),
      )
    : undefined;
  const requestedRuntime =
    requestedRuntimeManager === undefined
      ? undefined
      : new ConversationRequestedRuntimeResponder(requestedRuntimeManager, input.resultResponder);
  return {
    surfaceEffects,
    platformAction: new ConversationPlatformActionRouter(
      discord,
      workforce,
      delegate,
      input.deliberation?.responder,
      requestedRuntime,
    ),
    close: () => requestedRuntimeManager?.closeAll() ?? Promise.resolve(),
  };
}
