import {
  HubConversationRemoteContinuation,
  HubWorkstreamContinuationResolver,
} from "@lervo/conversation-app";
import type { ConversationRemoteContinuationPort } from "@lervo/conversation-control";
import type { ConversationAgentBinding } from "@lervo/schemas";
import { AuthenticatedRemoteCommandHttpSubmission } from "@lervo/remote-command";
import { AuthenticatedHubHttpTransport } from "@lervo/sync";

import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";
import type { ConversationRequestedEffect } from "./conversation-intent-resolver.js";
import { discordSpeakerParticipantKeys } from "./discord-conversation-speaker.js";

interface DiscordCompositionOptions {
  config: NodeDiscordConversationConfig;
  hub: NodeRuntimeConfig["hub"];
  project: { projectId: string; projectIdentityHash: string };
  bearerToken(): string;
}

export type DiscordPeerAgentBinding = NonNullable<
  NodeDiscordConversationConfig["peerAgents"]
>[number] & { agentBinding: ConversationAgentBinding; displayName?: string };

export function effectiveDiscordPeerAgents(
  configured: readonly DiscordPeerAgentBinding[],
  current: readonly DiscordPeerAgentBinding[],
): DiscordPeerAgentBinding[] {
  const currentIds = new Set(current.map((peer) => peer.participantId));
  return [...current, ...configured.filter((peer) => !currentIds.has(peer.participantId))];
}

export interface AuthorizedAgentEffectRequester {
  participantId: string;
  roleId: string;
  conversationId: string;
  effectKinds: readonly ConversationRequestedEffect["kind"][];
}

const manuallyAuthorizedEffects: readonly ConversationRequestedEffect["kind"][] = [
  "repository_work",
  "supervision_goal_request",
  "discord_current_member_nickname_set",
  "discord_guild_text_channel_create",
  "discord_public_thread_create",
  "workforce_agent_hire",
  "workforce_task_delegate",
  "deliberation_start",
  "requested_runtime_open",
  "requested_runtime_close",
];

export function createAuthorizedAgentEffectRequesters(
  config: NodeDiscordConversationConfig,
  routablePeers: readonly DiscordPeerAgentBinding[] = [],
): AuthorizedAgentEffectRequester[] {
  const authorizations = new Map<string, AuthorizedAgentEffectRequester>();
  const add = (
    participantId: string,
    roleId: string,
    conversationId: string,
    effects: readonly ConversationRequestedEffect["kind"][],
  ) => {
    const key = `${participantId}\0${roleId}\0${conversationId}`;
    const current = authorizations.get(key);
    authorizations.set(key, {
      participantId,
      roleId,
      conversationId,
      effectKinds: [...new Set([...(current?.effectKinds ?? []), ...effects])].sort(),
    });
  };
  for (const participant of config.participants) {
    if (participant.mayRequestEffects !== true || participant.roleId === null) continue;
    for (const conversation of config.conversations) {
      if (conversation.tenantKey !== participant.tenantKey) continue;
      add(
        participant.participantId,
        participant.roleId,
        conversation.conversationId,
        manuallyAuthorizedEffects,
      );
    }
  }
  for (const peer of routablePeers) {
    for (const conversationId of peer.conversationIds) {
      add(
        peer.participantId,
        peer.roleId,
        conversationId,
        config.policy?.acceptsPeerWork === true
          ? [
              "repository_work",
              "workforce_task_delegate",
              "deliberation_start",
              ...(config.administration?.allowedActions.includes("requested_runtime.manage") ===
              true
                ? (["requested_runtime_open", "requested_runtime_close"] as const)
                : []),
            ]
          : ["workforce_task_delegate"],
      );
    }
  }
  return [...authorizations.values()].sort((left, right) =>
    `${left.conversationId}\0${left.participantId}`.localeCompare(
      `${right.conversationId}\0${right.participantId}`,
    ),
  );
}

export function createDiscordHubContinuation(
  options: DiscordCompositionOptions,
): ConversationRemoteContinuationPort {
  const { config } = options;
  const target = {
    projectId: options.project.projectId,
    projectIdentityHash: options.project.projectIdentityHash,
  };
  const httpOptions = () => ({
    baseUrl: options.hub.baseUrl,
    bearerToken: options.bearerToken(),
    expectedHubIdentityHash: options.hub.hubIdentityHash,
    ...(config.http?.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: config.http.requestTimeoutMs }),
    ...(config.http?.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: config.http.maxResponseBytes }),
  });
  return new HubConversationRemoteContinuation({
    target,
    destinationId: options.hub.destinationId,
    conversationIds: config.conversations.map((binding) => binding.conversationId),
    participantIds: [...new Set(config.participants.map((binding) => binding.participantId))],
    roleId: config.command.roleId,
    provider: config.command.provider,
    risk: config.command.risk,
    verificationSuiteIds: config.command.verificationSuiteIds,
    lifetimeMs: config.command.lifetimeMs,
    resolveContinuation: () =>
      new HubWorkstreamContinuationResolver({
        target,
        destinationId: options.hub.destinationId,
        expectedHubIdentityHash: options.hub.hubIdentityHash,
        assignmentId: config.command.assignmentId,
        agentId: config.command.agentId,
        transport: new AuthenticatedHubHttpTransport({
          ...httpOptions(),
          destinationId: options.hub.destinationId,
          target,
        }),
      }).resolve(),
    submission: {
      submit: (request) =>
        new AuthenticatedRemoteCommandHttpSubmission({
          ...httpOptions(),
          destinationId: options.hub.destinationId,
          target,
        }).submit(request),
    },
  });
}

export function createDiscordPlatformBindings(input: {
  config: NodeDiscordConversationConfig;
  projectId: string;
  agentRoleId: string;
  agentBinding?: ConversationAgentBinding;
  peerAgents?: DiscordPeerAgentBinding[];
}) {
  const { config } = input;
  const peerAgents = effectiveDiscordPeerAgents(config.peerAgents ?? [], input.peerAgents ?? []);
  const tenantKeys = [...new Set(config.conversations.map((binding) => binding.tenantKey))];
  const manualParticipantKeys = new Set(
    config.participants.map(
      (participant) =>
        `${participant.tenantKey}\0${participant.actorKind === "agent" ? "bot" : "user"}:${participant.userId}`,
    ),
  );
  return {
    conversations: config.conversations.map((binding) => ({
      platform: "discord" as const,
      integrationId: config.integrationId,
      tenantKey: binding.tenantKey,
      conversationKey: binding.conversationKey,
      projectId: input.projectId,
      conversationId: binding.conversationId,
    })),
    participants: [
      ...config.participants.map((binding) => {
        const participantKey = `${binding.actorKind === "agent" ? "bot" : "user"}:${binding.userId}`;
        const peer = peerAgents.find(
          (candidate) =>
            candidate.participantId === binding.participantId &&
            candidate.roleId === binding.roleId &&
            candidate.tenantKeys.includes(binding.tenantKey) &&
            candidate.participantKeys.includes(participantKey),
        );
        return {
          platform: "discord" as const,
          integrationId: config.integrationId,
          tenantKey: binding.tenantKey,
          participantKey,
          actor: {
            kind: binding.actorKind,
            participantId: binding.participantId,
            roleId: binding.roleId,
            ...(peer === undefined ? {} : { agentBinding: peer.agentBinding }),
          },
          ...(binding.startsAutomationChain === true ? { startsAutomationChain: true } : {}),
        };
      }),
      ...tenantKeys.flatMap((tenantKey) =>
        discordSpeakerParticipantKeys(config).map((participantKey) => ({
          platform: "discord" as const,
          integrationId: config.integrationId,
          tenantKey,
          participantKey,
          actor: {
            kind: "agent" as const,
            participantId: config.agentParticipantId,
            roleId: input.agentRoleId,
            ...(input.agentBinding === undefined ? {} : { agentBinding: input.agentBinding }),
          },
        })),
      ),
      ...peerAgents.flatMap((peer) =>
        tenantKeys.flatMap((tenantKey) =>
          peer.tenantKeys.includes(tenantKey)
            ? peer.participantKeys
                .filter(
                  (participantKey) => !manualParticipantKeys.has(`${tenantKey}\0${participantKey}`),
                )
                .map((participantKey) => ({
                  platform: "discord" as const,
                  integrationId: config.integrationId,
                  tenantKey,
                  participantKey,
                  actor: {
                    kind: "agent" as const,
                    participantId: peer.participantId,
                    roleId: peer.roleId,
                    agentBinding: peer.agentBinding,
                  },
                }))
            : [],
        ),
      ),
    ],
  };
}
