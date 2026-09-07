import { randomUUID } from "node:crypto";
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
import type { RemoteCommandDeliveryAcknowledgement, RemoteCommandLease } from "@lervo/schemas";
import { AuthenticatedHubHttpTransport } from "@lervo/sync";
import { createLocalProviderWritingEvaluator } from "@lervo/provider-writing-evaluator";

import { ConversationResultRuntime } from "./conversation-result-runtime.js";
import { RepositoryConversationResultSource } from "./conversation-result-source.js";
import { SQLiteConversationResultStore } from "./conversation-result-store.js";
import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";
import { loadDiscordBotToken } from "./discord-credentials.js";
import { createNodeProviderAdapter } from "./managed-provider-runtime.js";

export interface NodeDiscordConversationRuntime {
  readonly failed: Promise<void>;
  observeRemoteAcknowledgement(input: {
    lease: RemoteCommandLease;
    acknowledgement: RemoteCommandDeliveryAcknowledgement;
  }): Promise<"ready" | "duplicate" | "ignored">;
  runResultDeliveryCycle(): ReturnType<ConversationResultRuntime["runCycle"]>;
  stopIngress(): void;
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
  repositoryRoot: string;
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
  const resultStore = await SQLiteConversationResultStore.open(
    resolve(options.dataDirectory, "execution-results.sqlite"),
  );
  const upstreamContinuation = options.continuation ?? createHubContinuation(options);
  let resultRuntime: ConversationResultRuntime | null = null;
  const continuation: ConversationRemoteContinuationPort = {
    request: async (input) => {
      const queued = await upstreamContinuation.request(input);
      if (queued.provider !== config.command.provider || queued.roleId !== config.command.roleId) {
        throw new Error("The queued command differs from the Discord result policy.");
      }
      await resultStore.register({
        deliveryId: queued.deliveryId,
        commandId: queued.commandId,
        sourceEventId: input.eventId,
        target: {
          integrationId: config.integrationId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          threadId: input.threadId,
        },
        policyId: policy.policyId,
        agentParticipantId: config.agentParticipantId,
        roleId: queued.roleId,
        provider: config.command.provider,
        workstreamId: queued.workstreamId,
        workstreamRevision: queued.workstreamRevision,
        workstreamSnapshotContentHash: queued.workstreamSnapshotContentHash,
        assignmentId: queued.assignmentId,
        agentId: queued.agentId,
        queuedAt: queued.queuedAt,
      });
      return queued;
    },
  };
  const responder = new ConversationRemoteContinuationResponder({
    artifactStore: artifacts,
    continuation,
    writingContract: fixedEnglishStatusWritingContract,
  });
  const publicationVerifier = new VerifiedConversationPublication({
    artifactStore: artifacts,
    resolveWritingContract: async () => fixedEnglishStatusWritingContract,
  });
  let application: Awaited<ReturnType<typeof openConversationApplication>> | undefined;
  try {
    application = await openConversationApplication({
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
              const code =
                "code" in error && typeof error.code === "string" ? error.code : "unknown";
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
    const openedApplication = application;
    const adapter = openedApplication.discordAdapters.get(config.integrationId);
    if (adapter === undefined) throw new Error("The Discord result adapter is unavailable.");
    resultRuntime = new ConversationResultRuntime({
      workerId: `${config.workerId}:result`,
      store: resultStore,
      artifacts,
      adapter,
      semanticEvaluator: createLocalProviderWritingEvaluator({
        provider: config.command.provider,
        projectId: options.project.projectId,
        createAdapter: createNodeProviderAdapter,
        createId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
        now: () => new Date(),
      }),
      source: new RepositoryConversationResultSource(options.repositoryRoot),
    });
    return {
      failed: failure,
      observeRemoteAcknowledgement: (input) => resultRuntime!.observe(input),
      runResultDeliveryCycle: () => resultRuntime!.runCycle(),
      stopIngress: () => openedApplication.stopIngress(),
      close: () => {
        openedApplication.close();
        resultRuntime!.close();
      },
    };
  } catch (error) {
    application?.close();
    resultRuntime?.close();
    if (resultRuntime === null) resultStore.close();
    throw error;
  }
}
