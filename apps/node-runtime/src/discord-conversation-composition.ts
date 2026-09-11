import {
  HubConversationRemoteContinuation,
  HubWorkstreamContinuationResolver,
} from "@lervo/conversation-app";
import type { ConversationRemoteContinuationPort } from "@lervo/conversation-control";
import type { ConversationAgentBinding } from "@lervo/schemas";
import { AuthenticatedRemoteCommandHttpSubmission } from "@lervo/remote-command";
import { AuthenticatedHubHttpTransport } from "@lervo/sync";

import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";
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

export function createAuthorizedAgentEffectRequesters(
  config: NodeDiscordConversationConfig,
  peerAgents: readonly DiscordPeerAgentBinding[],
) {
  return [
    ...config.participants.flatMap((participant) =>
      participant.mayRequestEffects === true && participant.roleId !== null
        ? config.conversations
            .filter((conversation) => conversation.tenantKey === participant.tenantKey)
            .map((conversation) => ({
              participantId: participant.participantId,
              roleId: participant.roleId!,
              conversationId: conversation.conversationId,
            }))
        : [],
    ),
    ...peerAgents.flatMap((peer) =>
      peer.roleId === "ceo"
        ? peer.conversationIds.map((conversationId) => ({
            participantId: peer.participantId,
            roleId: peer.roleId,
            conversationId,
          }))
        : [],
    ),
  ];
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
  const peerAgents = [...(config.peerAgents ?? []), ...(input.peerAgents ?? [])];
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
                  startsAutomationChain: true,
                }))
            : [],
        ),
      ),
    ],
  };
}
