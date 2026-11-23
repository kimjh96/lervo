import { openConversationApplication } from "@lervo/conversation-app";
import {
  createDiscordPlatformBindings,
  effectiveDiscordPeerAgents,
  type DiscordPeerAgentBinding,
} from "./discord-conversation-composition.js";
import { ConversationResultRuntime } from "./conversation-result-runtime.js";
import { resolveDiscordAgentParticipation } from "./discord-agent-participation.js";
import type { ConversationInteractionRetryLoop } from "./conversation-interaction-retry-loop.js";
import { ConversationRepositorySignalLoop } from "./conversation-repository-signal-loop.js";
import { startDiscordConversationBackground } from "./discord-conversation-background.js";
import { createDiscordConversationResultRuntime } from "./discord-conversation-result-composition.js";
import { openDiscordConversationResponseComposition } from "./discord-conversation-response-composition.js";
import { loadDiscordConversationDeliveryCredentials } from "./discord-conversation-webhook-delivery.js";
import { discordSpeakerParticipantKeys } from "./discord-conversation-speaker.js";
import type {
  NodeDiscordConversationRuntime,
  NodeDiscordConversationRuntimeOptions,
} from "./discord-conversation-runtime-types.js";
import { registerConversationPeerTurnEndpoint } from "./conversation-peer-turn-router.js";
import type { ConversationDiscussionDeadlineLoop } from "./conversation-discussion-deadline-loop.js";

export * from "./discord-conversation-runtime-types.js";

export async function openNodeDiscordConversationRuntime(
  options: NodeDiscordConversationRuntimeOptions,
): Promise<NodeDiscordConversationRuntime> {
  const config = options.config;
  const peerAgents: DiscordPeerAgentBinding[] = effectiveDiscordPeerAgents(
    config.peerAgents ?? [],
    options.peerAgents ?? [],
  );
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
    peerAgents,
  });
  const response = await openDiscordConversationResponseComposition({
    options,
    botToken: token,
    participation: agentParticipation,
    peerAgents,
  });
  let resultRuntime: ConversationResultRuntime | null = null;
  let interactionRetryLoop: ConversationInteractionRetryLoop | null = null;
  let repositorySignalLoop: ConversationRepositorySignalLoop | null = null;
  let discussionDeadlineLoop: ConversationDiscussionDeadlineLoop | null = null;
  let unregisterPeerTurnEndpoint: (() => void) | null = null;
  let unregisterDeliberationParticipant: (() => void) | null = null;
  let application: Awaited<ReturnType<typeof openConversationApplication>> | undefined;
  try {
    application = await openConversationApplication({
      dataDirectory: options.dataDirectory,
      ...(options.operationDrain === undefined ? {} : { operationDrain: options.operationDrain }),
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
            policy: response.policy,
            agentParticipantId: config.agentParticipantId,
            ...(agentParticipation.agentBinding === undefined
              ? {}
              : { agentBinding: agentParticipation.agentBinding }),
            responder: response.responder,
            publicationVerifier: response.publicationVerifier,
            responseFailureClassifier: response.responseFailureClassifier,
            terminalFailureResponder: response.terminalFailureResponder,
            terminalFailurePublicationVerifier: response.terminalFailurePublicationVerifier,
            ...(response.relevanceEvaluator === null
              ? {}
              : { relevanceEvaluator: response.relevanceEvaluator }),
            turnOwnershipEvaluator: response.turnOwnershipEvaluator,
          },
        ],
        workerId: config.workerId,
        leaseDurationMs: 300_000,
        maximumResponseAttempts: config.policy?.maxResponseAttempts ?? 3,
        onDelivered: ({ outbound }) => {
          if (!response.reconfigurationEvents.delete(outbound.sourceEventId)) return;
          fail("conversation_reconfiguration_requested");
        },
      },
      ...(response.deliberationRuntime === null
        ? {}
        : { deliberations: response.deliberationRuntime.applicationOptions }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    const openedApplication = application;
    unregisterPeerTurnEndpoint =
      options.peerTurnRouter === undefined
        ? null
        : registerConversationPeerTurnEndpoint({
            router: options.peerTurnRouter,
            integrationId: config.integrationId,
            projectId: options.project.projectId,
            participantId: config.agentParticipantId,
            conversationIds: config.conversations.map((binding) => binding.conversationId),
            acceptedPeers: peerAgents,
            artifacts: response.artifacts,
            handle: (event) => openedApplication.handleInboundEvent!(event),
            deliver: async () => {
              await openedApplication.runDeliveryCycle?.(config.integrationId);
            },
          });
    unregisterDeliberationParticipant =
      config.deliberationParticipation === undefined ||
      options.deliberationParticipants === undefined
        ? null
        : options.deliberationParticipants.attach({
            participantId: config.agentParticipantId,
            artifacts: response.artifacts,
            handle: (event) => openedApplication.handleInboundEvent!(event),
            deliver: (integrationId) => openedApplication.runDeliveryCycle!(integrationId),
          });
    const adapter = openedApplication.discordAdapters.get(config.integrationId);
    if (adapter === undefined) throw new Error("The Discord result adapter is unavailable.");
    resultRuntime = createDiscordConversationResultRuntime({
      config,
      projectId: options.project.projectId,
      providerPolicy: agentParticipation.providerPolicy ?? null,
      repositoryRoot: options.repositoryRoot,
      ...(options.providerExecutables === undefined
        ? {}
        : { providerExecutables: options.providerExecutables }),
      store: response.resultStore,
      artifacts: response.artifacts,
      adapter,
    });
    ({ interactionRetryLoop, repositorySignalLoop, discussionDeadlineLoop } =
      startDiscordConversationBackground({
        options,
        application: openedApplication,
        artifacts: response.artifacts,
        deliberation: response.deliberationRuntime,
        discussion: response.discussionRuntime,
        fail,
      }));
    return {
      failed: failure,
      resultAdapter: (integrationId) => (integrationId === config.integrationId ? adapter : null),
      resultArtifacts: (integrationId) =>
        integrationId === config.integrationId ? response.artifacts : null,
      resultReplay: (integrationId, outboundId) =>
        integrationId === config.integrationId
          ? openedApplication.inspectDeliveryReplay({
              platform: "discord",
              integrationId,
              outboundId,
            })
          : null,
      observeRemoteAcknowledgement: (input) =>
        options.operationDrain?.run(() => resultRuntime!.observe(input)) ??
        resultRuntime!.observe(input),
      runResultDeliveryCycle: async () => {
        await (options.operationDrain?.run(() => resultRuntime!.runCycle()) ??
          resultRuntime!.runCycle());
      },
      stopIngress: () => {
        void interactionRetryLoop!.stop();
        void discussionDeadlineLoop?.stop();
        void repositorySignalLoop?.stop();
        void response.deliberationRuntime?.stop();
        openedApplication.stopIngress();
      },
      close: async () => {
        unregisterPeerTurnEndpoint?.();
        unregisterDeliberationParticipant?.();
        await interactionRetryLoop!.stop();
        await discussionDeadlineLoop?.stop();
        await repositorySignalLoop?.stop();
        await response.deliberationRuntime?.stop();
        await openedApplication.close();
        resultRuntime!.close();
        await response.close();
      },
    };
  } catch (error) {
    unregisterPeerTurnEndpoint?.();
    unregisterDeliberationParticipant?.();
    await interactionRetryLoop?.stop();
    await discussionDeadlineLoop?.stop();
    await repositorySignalLoop?.stop();
    await response.deliberationRuntime?.stop();
    await application?.close();
    resultRuntime?.close();
    await response.close();
    if (resultRuntime === null) response.resultStore.close();
    throw error;
  }
}
