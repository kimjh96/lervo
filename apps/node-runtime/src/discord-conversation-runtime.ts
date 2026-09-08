import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { openConversationApplication } from "@lervo/conversation-app";
import { FileSystemCas } from "@lervo/cas";
import { createConversationParticipationPolicy } from "@lervo/conversation-contract";
import {
  ConversationRemoteContinuationResponder,
  type ConversationRemoteContinuationPort,
} from "@lervo/conversation-control";
import {
  FixedConversationTerminalFailureResponder,
  VerifiedConversationPublication,
} from "@lervo/conversation-responder";
import {
  adaptiveConversationWritingContract,
  fixedConversationStatusWritingContract,
  realtimeConversationWritingContract,
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
import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";
import { ConversationResultRuntime } from "./conversation-result-runtime.js";
import { RepositoryConversationResultSource } from "./conversation-result-source.js";
import { SQLiteConversationResultStore } from "./conversation-result-store.js";
import { openManagedConversationReadResponder } from "./conversation-read-responder.js";
import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";
import { NaturalLanguageDiscordConversationResponder } from "./discord-conversation-mode.js";
import { resolveDiscordAgentParticipation } from "./discord-agent-participation.js";
import type { DiscordAgentParticipation } from "./discord-agent-participation.js";
import { loadDiscordBotToken } from "./discord-credentials.js";
import { createNodeProviderAdapter } from "./managed-provider-runtime.js";
import { ConversationInteractionRetryLoop } from "./conversation-interaction-retry-loop.js";
import { NodeConversationResponseFailureClassifier } from "./conversation-response-failure-policy.js";
import { createDiscordConversationEffects } from "./discord-conversation-effects.js";
import { createDiscordConversationTurnOwnership } from "./discord-conversation-turn-ownership.js";

export interface NodeDiscordConversationRuntime {
  readonly failed: Promise<void>;
  observeRemoteAcknowledgement(input: {
    lease: RemoteCommandLease;
    acknowledgement: RemoteCommandDeliveryAcknowledgement;
  }): Promise<"ready" | "duplicate" | "ignored">;
  runResultDeliveryCycle(): Promise<void>;
  stopIngress(): void;
  close(): void | Promise<void>;
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
  agentParticipation?: DiscordAgentParticipation;
  peerAgents?: DiscordPeerAgentBinding[];
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
  const agentParticipation =
    options.agentParticipation ??
    (await resolveDiscordAgentParticipation({
      repositoryRoot: options.repositoryRoot,
      config,
    }));
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
    agentRoleId: agentParticipation.roleId,
    ...(agentParticipation.agentBinding === undefined
      ? {}
      : { agentBinding: agentParticipation.agentBinding }),
    ...(options.peerAgents === undefined ? {} : { peerAgents: options.peerAgents }),
  });
  const turnOwnershipEvaluator = createDiscordConversationTurnOwnership({
    participantId: config.agentParticipantId,
    roleId: agentParticipation.roleId,
    conversationIds: config.conversations.map((binding) => binding.conversationId),
    peers: options.peerAgents ?? [],
  });
  const policy = createConversationParticipationPolicy({
    projectId: options.project.projectId,
    roleId: agentParticipation.roleId,
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
  let interactionRetryLoop: ConversationInteractionRetryLoop | null = null;
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
        responseLanguage: /\p{Script=Hangul}/u.test(input.request) ? "ko" : "en",
        queuedAt: queued.queuedAt,
      });
      return queued;
    },
  };
  const continuationResponder = new ConversationRemoteContinuationResponder({
    artifactStore: artifacts,
    continuation,
    writingContract: fixedConversationStatusWritingContract,
  });
  let modeResponder: NaturalLanguageDiscordConversationResponder | null = null;
  let responder: ConversationResponder = continuationResponder;
  if (config.routing !== undefined) {
    const { surfaceEffects, platformAction } = createDiscordConversationEffects({
      config,
      botToken: token,
      artifactStore: artifacts,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    const readOnly =
      options.readOnlyResponder ??
      (readRuntime = await openManagedConversationReadResponder({
        config: { ...config, routing: config.routing },
        projectId: options.project.projectId,
        projectCreatedAt: options.project.createdAt,
        agentId: agentParticipation.agentId,
        participationRoleId: agentParticipation.roleId,
        repositoryRoot: options.repositoryRoot,
        dataDirectory: options.dataDirectory,
        artifactStore: artifacts,
        surfaceEffects,
        ...(options.providerExecutables === undefined
          ? {}
          : { providerExecutables: options.providerExecutables }),
      })).responder;
    const intentResolver =
      options.intentResolver ??
      (readRuntime === null && config.routing.intent !== undefined
        ? await createProviderConversationIntentResolver({
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
          })
        : undefined);
    if (readRuntime === null && intentResolver === undefined) {
      throw new Error(
        "A custom read-only responder requires either a custom intent resolver or legacy routing.intent configuration.",
      );
    }
    intentStore = await SQLiteConversationIntentResolutionStore.open(
      resolve(options.dataDirectory, "intent-resolutions.sqlite"),
    );
    modeResponder = new NaturalLanguageDiscordConversationResponder({
      applicationId: config.applicationId,
      respondingAgent: {
        agentId: agentParticipation.agentId,
        roleId: agentParticipation.roleId,
      },
      repositoryRoot: options.repositoryRoot,
      artifactStore: artifacts,
      history: new SQLiteConversationHistory(
        resolve(options.dataDirectory, "interactions.sqlite"),
        artifacts,
      ),
      resolutionStore: intentStore,
      ...(intentResolver === undefined ? {} : { intentResolver }),
      ...(readRuntime === null || options.intentResolver !== undefined
        ? {}
        : { managedTurnResolver: readRuntime.turnResolver }),
      surfaceEffects,
      participationPolicy: policy,
      readOnly,
      continuation: continuationResponder,
      platformAction,
    });
    responder = modeResponder;
  }
  const publicationVerifier = new VerifiedConversationPublication({
    artifactStore: artifacts,
    resolveWritingContract: async ({ event }) =>
      modeResponder !== null && ["read_only", "clarify"].includes(await modeResponder.mode(event))
        ? config.routing?.evaluation === undefined
          ? realtimeConversationWritingContract
          : adaptiveConversationWritingContract
        : fixedConversationStatusWritingContract,
  });
  const terminalFailureResponder = new FixedConversationTerminalFailureResponder({
    artifactStore: artifacts,
  });
  const terminalFailurePublicationVerifier = new VerifiedConversationPublication({
    artifactStore: artifacts,
    resolveWritingContract: () => fixedConversationStatusWritingContract,
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
            ...(agentParticipation.agentBinding === undefined
              ? {}
              : { agentBinding: agentParticipation.agentBinding }),
            responder,
            publicationVerifier,
            responseFailureClassifier: new NodeConversationResponseFailureClassifier(),
            terminalFailureResponder,
            terminalFailurePublicationVerifier,
            ...(modeResponder === null ? {} : { relevanceEvaluator: modeResponder }),
            turnOwnershipEvaluator,
          },
        ],
        workerId: config.workerId,
        leaseDurationMs: 300_000,
        maximumResponseAttempts: config.policy?.maxResponseAttempts ?? 3,
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
        provider: config.routing?.evaluation?.provider ?? config.command.provider,
        projectId: options.project.projectId,
        createAdapter: (adapterInput) =>
          createNodeProviderAdapter({
            ...adapterInput,
            ...(options.providerExecutables?.[adapterInput.provider] === undefined
              ? {}
              : { executable: options.providerExecutables[adapterInput.provider] }),
            ...(config.routing?.evaluation?.model === undefined
              ? {}
              : { model: config.routing.evaluation.model }),
            ...(config.routing?.evaluation?.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: config.routing.evaluation.reasoningEffort }),
          }),
        createId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
        now: () => new Date(),
      }),
      source: new RepositoryConversationResultSource(options.repositoryRoot),
    });
    interactionRetryLoop = new ConversationInteractionRetryLoop({
      runCycle: async () => {
        await openedApplication.runInteractionRetryCycle?.(config.integrationId);
      },
      onFailure: () => fail("interaction_retry_failed"),
    });
    interactionRetryLoop.start();
    return {
      failed: failure,
      observeRemoteAcknowledgement: (input) => resultRuntime!.observe(input),
      runResultDeliveryCycle: async () => {
        await resultRuntime!.runCycle();
      },
      stopIngress: () => {
        void interactionRetryLoop!.stop();
        openedApplication.stopIngress();
      },
      close: async () => {
        await interactionRetryLoop!.stop();
        openedApplication.close();
        resultRuntime!.close();
        readRuntime?.close();
        intentStore?.close();
      },
    };
  } catch (error) {
    await interactionRetryLoop?.stop();
    application?.close();
    resultRuntime?.close();
    readRuntime?.close();
    intentStore?.close();
    if (resultRuntime === null) resultStore.close();
    throw error;
  }
}
