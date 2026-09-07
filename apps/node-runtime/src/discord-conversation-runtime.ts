import { resolve } from "node:path";

import {
  HubConversationRemoteContinuation,
  HubWorkstreamContinuationResolver,
  openConversationApplication,
} from "@lervo/conversation-app";
import { FileSystemCas } from "@lervo/cas";
import { createConversationParticipationPolicy } from "@lervo/conversation-contract";
import {
  ConversationRemoteContinuationResponder,
  type ConversationRemoteContinuationPort,
} from "@lervo/conversation-control";
import { VerifiedConversationPublication } from "@lervo/conversation-responder";
import { fixedEnglishStatusWritingContract } from "@lervo/core";
import type { DiscordGatewayTransport } from "@lervo/discord-gateway";
import { AuthenticatedRemoteCommandHttpSubmission } from "@lervo/remote-command";
import { AuthenticatedHubHttpTransport } from "@lervo/sync";

import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";
import { loadDiscordBotToken } from "./discord-credentials.js";

export interface NodeDiscordConversationRuntime {
  readonly failed: Promise<void>;
  close(): void;
}

export interface NodeDiscordConversationRuntimeOptions {
  config: NodeDiscordConversationConfig;
  hub: NodeRuntimeConfig["hub"];
  project: {
    projectId: string;
    projectIdentityHash: string;
    createdAt: string;
  };
  dataDirectory: string;
  bearerToken(): string;
  continuation?: ConversationRemoteContinuationPort;
  gatewayTransport?: DiscordGatewayTransport;
  fetch?: typeof globalThis.fetch;
  onError?(error: Error): void;
  onReady(): void | Promise<void>;
  onFailure(code: string): void | Promise<void>;
}

function createHubContinuation(
  options: NodeDiscordConversationRuntimeOptions,
): ConversationRemoteContinuationPort {
  const config = options.config;
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

function platformBindings(options: NodeDiscordConversationRuntimeOptions) {
  const { config, project } = options;
  const tenantKeys = [...new Set(config.conversations.map((binding) => binding.tenantKey))];
  return {
    conversations: config.conversations.map((binding) => ({
      platform: "discord" as const,
      integrationId: config.integrationId,
      tenantKey: binding.tenantKey,
      conversationKey: binding.conversationKey,
      projectId: project.projectId,
      conversationId: binding.conversationId,
    })),
    participants: [
      ...config.participants.map((binding) => ({
        platform: "discord" as const,
        integrationId: config.integrationId,
        tenantKey: binding.tenantKey,
        participantKey: `user:${binding.userId}`,
        actor: {
          kind: "human" as const,
          participantId: binding.participantId,
          roleId: null,
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

export async function openNodeDiscordConversationRuntime(
  options: NodeDiscordConversationRuntimeOptions,
): Promise<NodeDiscordConversationRuntime> {
  const config = options.config;
  const token = await loadDiscordBotToken(config.botTokenFile);
  let resolveFailure!: () => void;
  let failed = false;
  const failure = new Promise<void>((resolvePromise) => {
    resolveFailure = resolvePromise;
  });
  const fail = (code: string) => {
    if (failed) return;
    failed = true;
    void Promise.resolve()
      .then(() => options.onFailure(code))
      .finally(resolveFailure);
  };
  const bindings = platformBindings(options);
  const policy = createConversationParticipationPolicy({
    projectId: options.project.projectId,
    roleId: config.command.roleId,
    conversationIds: config.conversations.map((binding) => binding.conversationId),
    mode: "mention_only",
    respondTo: ["human"],
    signalCodes: [],
    cooldownSeconds: config.policy?.cooldownSeconds ?? 0,
    maxResponsesPerHour: config.policy?.maxResponsesPerHour ?? 8,
    maxAutomationDepth: config.policy?.maxAutomationDepth ?? 2,
    createdAt: options.project.createdAt,
  });
  const artifacts = await FileSystemCas.open(resolve(options.dataDirectory, "artifacts"));
  const continuation = options.continuation ?? createHubContinuation(options);
  const responder = new ConversationRemoteContinuationResponder({
    artifactStore: artifacts,
    continuation,
    writingContract: fixedEnglishStatusWritingContract,
  });
  const publicationVerifier = new VerifiedConversationPublication({
    artifactStore: artifacts,
    resolveWritingContract: async () => fixedEnglishStatusWritingContract,
  });
  const application = await openConversationApplication({
    dataDirectory: options.dataDirectory,
    ...bindings,
    discord: [
      {
        integrationId: config.integrationId,
        applicationId: config.applicationId,
        allowedGuildIds: config.allowedGuildIds,
        allowDirectMessages: config.allowDirectMessages,
        botToken: token,
        gateway: {
          intents: config.intents,
          ...(config.gateway?.url === undefined ? {} : { gatewayUrl: config.gateway.url }),
          ...(config.gateway?.reconnectDelayMs === undefined
            ? {}
            : { reconnectDelayMs: config.gateway.reconnectDelayMs }),
          ...(config.gateway?.maximumPayloadBytes === undefined
            ? {}
            : { maximumPayloadBytes: config.gateway.maximumPayloadBytes }),
          ...(config.gateway?.maximumDispatchRecords === undefined
            ? {}
            : { maximumDispatchRecords: config.gateway.maximumDispatchRecords }),
          ...(options.gatewayTransport === undefined
            ? {}
            : { transport: options.gatewayTransport }),
          onReady: () => options.onReady(),
          onError: (error) => {
            options.onError?.(error);
            const code = "code" in error && typeof error.code === "string" ? error.code : "unknown";
            if (
              ["authentication_failed", "dispatch_failed", "invalid_configuration"].includes(code)
            ) {
              fail(code);
            }
          },
        },
      },
    ],
    interactions: {
      bindings: [
        {
          policy,
          agentParticipantId: config.agentParticipantId,
          responder,
          publicationVerifier,
        },
      ],
      workerId: config.workerId,
    },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return {
    failed: failure,
    close: () => application.close(),
  };
}
