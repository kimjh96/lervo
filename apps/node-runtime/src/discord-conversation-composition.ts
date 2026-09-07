import {
  HubConversationRemoteContinuation,
  HubWorkstreamContinuationResolver,
} from "@lervo/conversation-app";
import type { ConversationRemoteContinuationPort } from "@lervo/conversation-control";
import { AuthenticatedRemoteCommandHttpSubmission } from "@lervo/remote-command";
import { AuthenticatedHubHttpTransport } from "@lervo/sync";

import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";

interface DiscordCompositionOptions {
  config: NodeDiscordConversationConfig;
  hub: NodeRuntimeConfig["hub"];
  project: { projectId: string; projectIdentityHash: string };
  bearerToken(): string;
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
}) {
  const { config } = input;
  const tenantKeys = [...new Set(config.conversations.map((binding) => binding.tenantKey))];
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
      ...config.participants.map((binding) => ({
        platform: "discord" as const,
        integrationId: config.integrationId,
        tenantKey: binding.tenantKey,
        participantKey: `${binding.actorKind === "agent" ? "bot" : "user"}:${binding.userId}`,
        actor: {
          kind: binding.actorKind,
          participantId: binding.participantId,
          roleId: binding.roleId,
        },
      })),
      ...tenantKeys.map((tenantKey) => ({
        platform: "discord" as const,
        integrationId: config.integrationId,
        tenantKey,
        participantKey: `user:${config.applicationId}`,
        actor: {
          kind: "agent" as const,
          participantId: config.agentParticipantId,
          roleId: config.command.roleId,
        },
      })),
    ],
  };
}
