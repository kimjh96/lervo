import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { openConversationApplication } from "@lervo/conversation-app";
import { FileSystemCas } from "@lervo/cas";
import { createConversationParticipationPolicy } from "@lervo/conversation-contract";
import {
  ConversationRemoteContinuationResponder,
  type ConversationRemoteContinuationPort,
} from "@lervo/conversation-control";
import { VerifiedConversationPublication } from "@lervo/conversation-responder";
import {
  adaptiveConversationWritingContract,
  fixedEnglishStatusWritingContract,
} from "@lervo/core";
import type { DiscordGatewayTransport } from "@lervo/discord-gateway";
import type { ConversationResponder } from "@lervo/interaction";
import type { RemoteCommandDeliveryAcknowledgement, RemoteCommandLease } from "@lervo/schemas";
import { createLocalProviderWritingEvaluator } from "@lervo/provider-writing-evaluator";

import {
  createProviderConversationIntentResolver,
  type ConversationIntentResolver,
} from "./conversation-intent-resolver.js";
import { SQLiteConversationHistory } from "./conversation-history.js";
import { SQLiteConversationIntentResolutionStore } from "./conversation-intent-store.js";
import {
  createDiscordHubContinuation,
  createDiscordPlatformBindings,
} from "./discord-conversation-composition.js";
import { ConversationResultRuntime } from "./conversation-result-runtime.js";
import { RepositoryConversationResultSource } from "./conversation-result-source.js";
import { SQLiteConversationResultStore } from "./conversation-result-store.js";
import { openManagedConversationReadResponder } from "./conversation-read-responder.js";
import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";
import { NaturalLanguageDiscordConversationResponder } from "./discord-conversation-mode.js";
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
  readOnlyResponder?: ConversationResponder;
  intentResolver?: ConversationIntentResolver;
  providerExecutables?: Partial<Record<"codex" | "claude", string>>;
  gatewayTransport?: DiscordGatewayTransport;
  fetch?: typeof globalThis.fetch;
  onError?(error: Error): void;
  onReady(): void | Promise<void>;
  onFailure(code: string): void | Promise<void>;
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
  const bindings = createDiscordPlatformBindings({
    config,
    projectId: options.project.projectId,
  });
  const policy = createConversationParticipationPolicy({
    projectId: options.project.projectId,
    roleId: config.command.roleId,
    conversationIds: config.conversations.map((binding) => binding.conversationId),
    mode: config.routing === undefined ? "mention_only" : "relevant",
    respondTo: config.policy?.respondTo ?? ["human"],
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
  const upstreamContinuation = options.continuation ?? createDiscordHubContinuation(options);
  let resultRuntime: ConversationResultRuntime | null = null;
  let readRuntime: Awaited<ReturnType<typeof openManagedConversationReadResponder>> | null = null;
  let intentStore: SQLiteConversationIntentResolutionStore | null = null;
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
  const continuationResponder = new ConversationRemoteContinuationResponder({
    artifactStore: artifacts,
    continuation,
    writingContract: fixedEnglishStatusWritingContract,
  });
  let modeResponder: NaturalLanguageDiscordConversationResponder | null = null;
  let responder: ConversationResponder = continuationResponder;
  if (config.routing !== undefined) {
    const readOnly =
      options.readOnlyResponder ??
      (readRuntime = await openManagedConversationReadResponder({
        config: { ...config, routing: config.routing },
        projectId: options.project.projectId,
        projectCreatedAt: options.project.createdAt,
        repositoryRoot: options.repositoryRoot,
        dataDirectory: options.dataDirectory,
        artifactStore: artifacts,
        ...(options.providerExecutables?.[config.routing.response.provider] === undefined
          ? {}
          : {
              providerExecutable: options.providerExecutables[config.routing.response.provider],
            }),
      })).responder;
    const intentResolver =
      options.intentResolver ??
      (await createProviderConversationIntentResolver({
        provider: config.routing.intent.provider,
        ...(options.providerExecutables?.[config.routing.intent.provider] === undefined
          ? {}
          : { executable: options.providerExecutables[config.routing.intent.provider] }),
        ...(config.routing.intent.model === undefined
          ? {}
          : { model: config.routing.intent.model }),
        ...(config.routing.intent.timeoutMs === undefined
          ? {}
          : { timeoutMs: config.routing.intent.timeoutMs }),
      }));
    intentStore = await SQLiteConversationIntentResolutionStore.open(
      resolve(options.dataDirectory, "intent-resolutions.sqlite"),
    );
    modeResponder = new NaturalLanguageDiscordConversationResponder({
      applicationId: config.applicationId,
      repositoryRoot: options.repositoryRoot,
      artifactStore: artifacts,
      history: new SQLiteConversationHistory(
        resolve(options.dataDirectory, "interactions.sqlite"),
        artifacts,
      ),
      resolutionStore: intentStore,
      intentResolver,
      readOnly,
      continuation: continuationResponder,
    });
    responder = modeResponder;
  }
  const publicationVerifier = new VerifiedConversationPublication({
    artifactStore: artifacts,
    resolveWritingContract: async ({ event }) =>
      modeResponder !== null && (await modeResponder.mode(event)) !== "continuation"
        ? adaptiveConversationWritingContract
        : fixedEnglishStatusWritingContract,
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
            ...(config.routing === undefined
              ? {}
              : { relevanceEvaluator: { evaluate: async () => "relevant" as const } }),
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
        createAdapter: (adapterInput) =>
          createNodeProviderAdapter({
            ...adapterInput,
            ...(options.providerExecutables?.[adapterInput.provider] === undefined
              ? {}
              : { executable: options.providerExecutables[adapterInput.provider] }),
          }),
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
        readRuntime?.close();
        intentStore?.close();
      },
    };
  } catch (error) {
    application?.close();
    resultRuntime?.close();
    readRuntime?.close();
    intentStore?.close();
    if (resultRuntime === null) resultStore.close();
    throw error;
  }
}
