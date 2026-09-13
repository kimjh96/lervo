import { resolve } from "node:path";

import { openConversationApplication } from "@lervo/conversation-app";
import { FileSystemCas } from "@lervo/cas";
import { ConversationRemoteContinuationResponder } from "@lervo/conversation-control";
import {
  FixedConversationTerminalFailureResponder,
  VerifiedConversationPublication,
} from "@lervo/conversation-responder";
import {
  adaptiveConversationWritingContract,
  fixedConversationStatusWritingContract,
  realtimeConversationWritingContract,
} from "@lervo/core";
import type { ConversationResponder } from "@lervo/interaction";

import { createProviderConversationIntentResolver } from "./conversation-intent-resolver.js";
import { SQLiteConversationHistory } from "./conversation-history.js";
import { SQLiteConversationIntentResolutionStore } from "./conversation-intent-store.js";
import {
  createAuthorizedAgentEffectRequesters,
  createDiscordHubContinuation,
  createDiscordPlatformBindings,
  type DiscordPeerAgentBinding,
} from "./discord-conversation-composition.js";
import { ConversationResultRuntime } from "./conversation-result-runtime.js";
import { SQLiteConversationResultStore } from "./conversation-result-store.js";
import { openManagedConversationReadResponder } from "./conversation-read-responder.js";
import { NaturalLanguageDiscordConversationResponder } from "./discord-conversation-mode.js";
import { resolveDiscordAgentParticipation } from "./discord-agent-participation.js";
import type { ConversationInteractionRetryLoop } from "./conversation-interaction-retry-loop.js";
import { NodeConversationResponseFailureClassifier } from "./conversation-response-failure-policy.js";
import { createDiscordConversationEffects } from "./discord-conversation-effects.js";
import { createDiscordConversationTurnOwnership } from "./discord-conversation-turn-ownership.js";
import { createDiscordConversationParticipationPolicy } from "./discord-conversation-participation-policy.js";
import { ConversationRepositorySignalLoop } from "./conversation-repository-signal-loop.js";
import { DiscordConversationDeliberationRuntime } from "./discord-conversation-deliberation-runtime.js";
import { startDiscordConversationBackground } from "./discord-conversation-background.js";
import { createDiscordConversationResultRuntime } from "./discord-conversation-result-composition.js";
import { createDiscordConversationContinuation } from "./discord-conversation-continuation.js";
import { openDiscordConversationRepositoryWork } from "./discord-conversation-repository-work.js";
import { loadDiscordConversationDeliveryCredentials } from "./discord-conversation-webhook-delivery.js";
import { discordSpeakerParticipantKeys } from "./discord-conversation-speaker.js";
import type {
  NodeDiscordConversationRuntime,
  NodeDiscordConversationRuntimeOptions,
} from "./discord-conversation-runtime-types.js";

export * from "./discord-conversation-runtime-types.js";

export async function openNodeDiscordConversationRuntime(
  options: NodeDiscordConversationRuntimeOptions,
): Promise<NodeDiscordConversationRuntime> {
  const config = options.config;
  const reconfigurationEvents = new Set<string>();
  const peerAgents: DiscordPeerAgentBinding[] = [
    ...(config.peerAgents ?? []),
    ...(options.peerAgents ?? []),
  ];
  const authorizedAgentEffectRequesters = createAuthorizedAgentEffectRequesters(config, peerAgents);
  const agentParticipation =
    options.agentParticipation ??
    (await resolveDiscordAgentParticipation({
      repositoryRoot: options.repositoryRoot,
      config,
    }));
  const { botToken: token, delivery: webhookDelivery } =
    await loadDiscordConversationDeliveryCredentials({
      config,
      agentDisplayName: agentParticipation.displayName,
    });
  let failed = false,
    resolveFailure!: () => void;
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
    peers: peerAgents,
  });
  const policy = createDiscordConversationParticipationPolicy({
    config,
    projectId: options.project.projectId,
    projectCreatedAt: options.project.createdAt,
    agentParticipation,
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
  let repositorySignalLoop: ConversationRepositorySignalLoop | null = null;
  const repositoryWork =
    config.routing === undefined
      ? null
      : openDiscordConversationRepositoryWork({
          config: { ...config, routing: config.routing },
          repositoryRoot: options.repositoryRoot,
          ...(options.repositoryReplica === undefined
            ? {}
            : { repositoryReplica: options.repositoryReplica }),
          dataDirectory: options.dataDirectory,
          artifactStore: artifacts,
          parentAgentId: agentParticipation.agentId ?? config.agentParticipantId,
          ...(options.runtimeConfigPath === undefined
            ? {}
            : { runtimeConfigPath: options.runtimeConfigPath }),
          authorizedEffectRequesters: authorizedAgentEffectRequesters,
          ...(options.providerExecutables === undefined
            ? {}
            : { providerExecutables: options.providerExecutables }),
          ...(options.providerModels === undefined
            ? {}
            : { providerModels: options.providerModels }),
          ...(options.providerReasoningEfforts === undefined
            ? {}
            : { providerReasoningEfforts: options.providerReasoningEfforts }),
          ...(options.repositoryWorkExecutor === undefined
            ? {}
            : { executor: options.repositoryWorkExecutor }),
        });
  const deliberationRuntime =
    config.deliberation === undefined
      ? null
      : await DiscordConversationDeliberationRuntime.open({
          config: config.deliberation,
          integrationId: config.integrationId,
          projectId: options.project.projectId,
          repositoryRoot: options.repositoryRoot,
          artifactStore: artifacts,
          onFailure: () => fail("deliberation_worker_failed"),
        });
  const continuation = createDiscordConversationContinuation({
    config,
    policy,
    resultStore,
    upstream: upstreamContinuation,
  });
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
      repositoryRoot: options.repositoryRoot,
      parentAgentId: agentParticipation.agentId,
      parentRoleId: agentParticipation.roleId,
      ...(repositoryWork === null ? {} : { repositoryWorkStore: repositoryWork.store }),
      ...(options.runtimeConfigPath === undefined
        ? {}
        : { runtimeConfigPath: options.runtimeConfigPath }),
      onDeploymentPrepared: (sourceEventId) => reconfigurationEvents.add(sourceEventId),
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
        repositoryResources: options.managedRepositoryResources,
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
      authorizedAgentEffectRequesters,
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
      work: repositoryWork!.responder,
      platformAction,
      ...(deliberationRuntime === null ? {} : { explicitControl: deliberationRuntime.responder }),
    });
    responder = modeResponder;
  }
  const publicationVerifier = new VerifiedConversationPublication({
    artifactStore: artifacts,
    resolveWritingContract: async ({ event }) =>
      modeResponder !== null &&
      ["read_only", "clarify", "work"].includes(await modeResponder.mode(event))
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
          textualParticipantAliases: [
            ...(agentParticipation.displayName === null
              ? []
              : discordSpeakerParticipantKeys(config)
                  .slice(0, 1)
                  .map((participantKey) => ({
                    displayName: agentParticipation.displayName!,
                    participantKey,
                  }))),
            ...peerAgents.flatMap((peer) =>
              peer.displayName === undefined
                ? []
                : peer.participantKeys.slice(0, 1).map((participantKey) => ({
                    displayName: peer.displayName!,
                    participantKey,
                  })),
            ),
          ],
          ...(webhookDelivery === undefined ? {} : { delivery: webhookDelivery }),
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
              if (["authentication_failed", "invalid_configuration"].includes(code)) {
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
            responseFailureClassifier: new NodeConversationResponseFailureClassifier(
              options.onError,
            ),
            terminalFailureResponder,
            terminalFailurePublicationVerifier,
            ...(modeResponder === null ? {} : { relevanceEvaluator: modeResponder }),
            turnOwnershipEvaluator,
          },
        ],
        workerId: config.workerId,
        leaseDurationMs: 300_000,
        maximumResponseAttempts: config.policy?.maxResponseAttempts ?? 3,
        onDelivered: ({ outbound }) => {
          if (!reconfigurationEvents.delete(outbound.sourceEventId)) return;
          fail("conversation_reconfiguration_requested");
        },
      },
      ...(deliberationRuntime === null
        ? {}
        : { deliberations: deliberationRuntime.applicationOptions }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    const openedApplication = application;
    const adapter = openedApplication.discordAdapters.get(config.integrationId);
    if (adapter === undefined) throw new Error("The Discord result adapter is unavailable.");
    resultRuntime = createDiscordConversationResultRuntime({
      config,
      projectId: options.project.projectId,
      repositoryRoot: options.repositoryRoot,
      ...(options.providerExecutables === undefined
        ? {}
        : { providerExecutables: options.providerExecutables }),
      store: resultStore,
      artifacts,
      adapter,
    });
    ({ interactionRetryLoop, repositorySignalLoop } = startDiscordConversationBackground({
      options,
      application: openedApplication,
      artifacts,
      deliberation: deliberationRuntime,
      fail,
    }));
    return {
      failed: failure,
      resultAdapter: (integrationId) => (integrationId === config.integrationId ? adapter : null),
      observeRemoteAcknowledgement: (input) => resultRuntime!.observe(input),
      runResultDeliveryCycle: async () => {
        await resultRuntime!.runCycle();
      },
      stopIngress: () => {
        void interactionRetryLoop!.stop();
        void repositorySignalLoop?.stop();
        void deliberationRuntime?.stop();
        openedApplication.stopIngress();
      },
      close: async () => {
        await interactionRetryLoop!.stop();
        await repositorySignalLoop?.stop();
        await deliberationRuntime?.stop();
        openedApplication.close();
        resultRuntime!.close();
        readRuntime?.close();
        repositoryWork?.responder.close();
        intentStore?.close();
      },
    };
  } catch (error) {
    await interactionRetryLoop?.stop();
    await repositorySignalLoop?.stop();
    await deliberationRuntime?.stop();
    application?.close();
    resultRuntime?.close();
    readRuntime?.close();
    repositoryWork?.responder.close();
    intentStore?.close();
    if (resultRuntime === null) resultStore.close();
    throw error;
  }
}
