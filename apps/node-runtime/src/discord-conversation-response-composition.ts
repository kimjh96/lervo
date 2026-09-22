import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import { ConversationRemoteContinuationResponder } from "@lervo/conversation-control";
import {
  FixedConversationTerminalFailureResponder,
  VerifiedConversationPublication,
  type ManagedConversationTurnRequest,
} from "@lervo/conversation-responder";
import { fixedConversationStatusWritingContract } from "@lervo/core";
import type { ConversationResponder } from "@lervo/interaction";

import { createProviderConversationIntentResolver } from "./conversation-intent-resolver.js";
import { conversationPublicationWritingContract } from "./conversation-publication-writing-contract.js";
import { SQLiteConversationHistory } from "./conversation-history.js";
import { SQLiteConversationIntentResolutionStore } from "./conversation-intent-store.js";
import {
  createAuthorizedAgentEffectRequesters,
  createDiscordHubContinuation,
  type DiscordPeerAgentBinding,
} from "./discord-conversation-composition.js";
import { SQLiteConversationResultStore } from "./conversation-result-store.js";
import { openManagedConversationReadResponder } from "./conversation-read-responder.js";
import { NaturalLanguageDiscordConversationResponder } from "./discord-conversation-mode.js";
import type { DiscordAgentParticipation } from "./discord-agent-participation.js";
import { NodeConversationResponseFailureClassifier } from "./conversation-response-failure-policy.js";
import { ConversationEffectResultResponderBinding } from "./conversation-effect-result-responder.js";
import { ConversationDiscussionActionResponder } from "./conversation-discussion-action-responder.js";
import { ConversationDiscussionRuntime } from "./conversation-discussion-runtime.js";
import { createDiscordConversationEffects } from "./discord-conversation-effects.js";
import { createDiscordConversationTurnOwnership } from "./discord-conversation-turn-ownership.js";
import { discordUnaddressedPriorityKey } from "./discord-conversation-priorities.js";
import { createDiscordConversationParticipationPolicy } from "./discord-conversation-participation-policy.js";
import {
  ConversationDeliberationSignalResponder,
  isDeliberationPublicationSignal,
} from "./conversation-deliberation-signal-responder.js";
import { DiscordConversationDeliberationRuntime } from "./discord-conversation-deliberation-runtime.js";
import { createDiscordConversationContinuation } from "./discord-conversation-continuation.js";
import { openDiscordConversationWork, supervisionGoalEffect } from "./discord-conversation-work.js";
import type { NodeDiscordConversationRuntimeOptions } from "./discord-conversation-runtime-types.js";

export async function openDiscordConversationResponseComposition(input: {
  options: NodeDiscordConversationRuntimeOptions;
  botToken: string;
  participation: DiscordAgentParticipation;
  peerAgents: readonly DiscordPeerAgentBinding[];
}) {
  const { options, participation, peerAgents } = input;
  const config = options.config;
  const repositoryWorkRouting = {
    configuredDefault: {
      provider: config.command.provider,
      requestedModel: options.providerModels?.[config.command.provider] ?? null,
      requestedReasoningEffort: options.providerReasoningEfforts?.[config.command.provider] ?? null,
    },
    executionProfiles:
      options.providerExecutionProfiles === undefined
        ? null
        : (Object.fromEntries(
            Object.entries(options.providerExecutionProfiles).map(([profile, policy]) => [
              profile,
              {
                preferredProvider: policy.preferredProvider,
                providers: Object.fromEntries(
                  Object.entries(policy.providers).map(([provider, route]) => [
                    provider,
                    {
                      requestedModel: route.model ?? null,
                      requestedReasoningEffort: route.reasoningEffort,
                    },
                  ]),
                ),
              },
            ]),
          ) as NonNullable<
            ManagedConversationTurnRequest["repositoryWorkRouting"]
          >["executionProfiles"]),
  } satisfies NonNullable<ManagedConversationTurnRequest["repositoryWorkRouting"]>;
  const reconfigurationEvents = new Set<string>();
  const authorizedAgentEffectRequesters = createAuthorizedAgentEffectRequesters(config, peerAgents);
  const policy = createDiscordConversationParticipationPolicy({
    config,
    projectId: options.project.projectId,
    projectCreatedAt: options.project.createdAt,
    agentParticipation: participation,
    hasPeerAgents: peerAgents.length > 0,
  });
  const artifacts = await FileSystemCas.open(resolve(options.dataDirectory, "artifacts"));
  const effectResultResponder = new ConversationEffectResultResponderBinding();
  const discussionRuntime = await ConversationDiscussionRuntime.open({
    path: resolve(options.dataDirectory, "conversation-discussions.sqlite"),
    integrationId: config.integrationId,
    participantId: config.agentParticipantId,
    roleId: participation.roleId,
    ...(participation.agentBinding === undefined
      ? {}
      : { agentBinding: participation.agentBinding }),
    peers: peerAgents,
    artifacts,
  });
  const turnOwnershipEvaluator = createDiscordConversationTurnOwnership({
    participantId: config.agentParticipantId,
    roleId: participation.roleId,
    conversationIds: config.conversations.map((binding) => binding.conversationId),
    peers: peerAgents,
    unaddressedPriorities:
      options.unaddressedPriorities ??
      new Map([
        ...config.conversations.map(
          (conversation) =>
            [
              discordUnaddressedPriorityKey(config.agentParticipantId, conversation.conversationId),
              config.policy?.unaddressedPriorities?.[conversation.conversationId] ??
                config.policy?.unaddressedPriority ??
                0,
            ] as const,
        ),
        ...peerAgents.flatMap((peer) =>
          peer.conversationIds.map(
            (conversationId) =>
              [
                discordUnaddressedPriorityKey(peer.participantId, conversationId),
                peer.unaddressedPriorities?.[conversationId] ?? peer.unaddressedPriority ?? 0,
              ] as const,
          ),
        ),
      ]),
    ...(options.turnFocusStore === undefined ? {} : { focusStore: options.turnFocusStore }),
    discussion: discussionRuntime,
  });
  const discussionAction = new ConversationDiscussionActionResponder({
    artifactStore: artifacts,
    discussion: discussionRuntime,
  });
  const { repositoryWork, workResponder, goalResponder } = openDiscordConversationWork({
    options,
    artifacts,
    participation,
    policyId: policy.policyId,
    resultResponder: effectResultResponder,
    authorizedEffectRequesters: authorizedAgentEffectRequesters.filter((requester) =>
      requester.effectKinds.some((kind) =>
        ["repository_work", "supervision_goal_request"].includes(kind),
      ),
    ),
  });
  const resultStore = await SQLiteConversationResultStore.open(
    resolve(options.dataDirectory, "execution-results.sqlite"),
  );
  const continuation = createDiscordConversationContinuation({
    config,
    policy,
    resultStore,
    upstream: options.continuation ?? createDiscordHubContinuation(options),
  });
  const continuationResponder = new ConversationRemoteContinuationResponder({
    artifactStore: artifacts,
    continuation,
    writingContract: fixedConversationStatusWritingContract,
  });
  const deliberationRuntime =
    config.deliberation === undefined
      ? null
      : await DiscordConversationDeliberationRuntime.open({
          config: config.deliberation,
          ...(options.providerExecutables === undefined
            ? {}
            : { providerExecutables: options.providerExecutables }),
          ...(options.providerModels === undefined
            ? {}
            : { providerModels: options.providerModels }),
          ...(options.providerReasoningEfforts === undefined
            ? {}
            : { providerReasoningEfforts: options.providerReasoningEfforts }),
          integrationId: config.integrationId,
          projectId: options.project.projectId,
          repositoryRoot: options.repositoryRoot,
          dataDirectory: options.dataDirectory,
          artifactStore: artifacts,
          repositoryArtifactStore: options.repositoryArtifactStore ?? artifacts,
          ...(options.repositoryEvents === undefined
            ? {}
            : { repositoryEvents: options.repositoryEvents }),
          onFailure: (error) =>
            options.onError?.(
              error instanceof Error
                ? error
                : new Error("The deliberation background cycle failed.", { cause: error }),
            ),
          ...(options.deliberationParticipants === undefined
            ? {}
            : { participantAssignments: options.deliberationParticipants }),
        });
  let readRuntime: Awaited<ReturnType<typeof openManagedConversationReadResponder>> | null = null;
  let intentStore: SQLiteConversationIntentResolutionStore | null = null;
  let modeResponder: NaturalLanguageDiscordConversationResponder | null = null;
  let responder: ConversationResponder = continuationResponder;
  let closeRequestedRuntimes = (): Promise<void> => Promise.resolve();
  if (config.routing !== undefined) {
    const effects = createDiscordConversationEffects({
      config,
      botToken: input.botToken,
      artifactStore: artifacts,
      repositoryRoot: options.repositoryRoot,
      parentAgentId: participation.agentId,
      parentRoleId: participation.roleId,
      ...(repositoryWork === null ? {} : { repositoryWorkStore: repositoryWork.store }),
      ...(options.runtimeConfigPath === undefined
        ? {}
        : { runtimeConfigPath: options.runtimeConfigPath }),
      onDeploymentPrepared: (sourceEventId) => reconfigurationEvents.add(sourceEventId),
      ...(options.peerTurnRouter === undefined || peerAgents.length === 0
        ? {}
        : {
            delegation: {
              parentParticipantId: config.agentParticipantId,
              ...(participation.agentBinding === undefined
                ? {}
                : { parentAgentBinding: participation.agentBinding }),
              peers: peerAgents,
              dispatcher: options.peerTurnRouter,
            },
          }),
      deliberation: {
        effect: discussionAction.surfaceEffect,
        responder: discussionAction,
      },
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.requestedRuntimeProcesses === undefined
        ? {}
        : { requestedRuntimeProcesses: options.requestedRuntimeProcesses }),
      resultResponder: effectResultResponder,
    });
    const { surfaceEffects: platformEffects, platformAction } = effects;
    closeRequestedRuntimes = effects.close;
    const surfaceEffects =
      goalResponder === null ? platformEffects : [...platformEffects, supervisionGoalEffect];
    const readOnly =
      options.readOnlyResponder ??
      (readRuntime = await openManagedConversationReadResponder({
        config: { ...config, routing: config.routing },
        projectId: options.project.projectId,
        projectCreatedAt: options.project.createdAt,
        agentId: participation.agentId,
        participationRoleId: participation.roleId,
        repositoryRoot: options.repositoryRoot,
        dataDirectory: options.dataDirectory,
        artifactStore: artifacts,
        surfaceEffects,
        repositoryResources: options.managedRepositoryResources,
        ...(options.providerExecutionProfiles === undefined
          ? {}
          : { providerExecutionProfiles: options.providerExecutionProfiles }),
        ...(options.providerExecutables === undefined
          ? {}
          : { providerExecutables: options.providerExecutables }),
      })).responder;
    effectResultResponder.bind(readOnly);
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
        participantId: config.agentParticipantId,
        agentId: participation.agentId,
        roleId: participation.roleId,
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
        : {
            managedTurnResolver: {
              resolve: (request: ManagedConversationTurnRequest) =>
                readRuntime!.turnResolver.resolve({ ...request, repositoryWorkRouting }),
            },
          }),
      surfaceEffects,
      availableEffects: [
        ...platformAction.availableEffects,
        ...(goalResponder === null ? [] : (["supervision_goal_request"] as const)),
      ],
      participationPolicy: policy,
      readOnly,
      continuation: continuationResponder,
      work: workResponder!,
      ...(goalResponder === null ? {} : { goal: goalResponder }),
      platformAction,
      discussion: discussionRuntime,
      ...(deliberationRuntime === null ? {} : { explicitControl: deliberationRuntime.responder }),
    });
    responder = modeResponder;
  }
  if (deliberationRuntime !== null || config.deliberationParticipation !== undefined) {
    responder = new ConversationDeliberationSignalResponder({
      artifactStore: artifacts,
      delegate: responder,
    });
  }
  return {
    artifacts,
    policy,
    resultStore,
    deliberationRuntime,
    discussionRuntime,
    reconfigurationEvents,
    responder,
    relevanceEvaluator: modeResponder,
    turnOwnershipEvaluator,
    publicationVerifier: new VerifiedConversationPublication({
      artifactStore: artifacts,
      resolveWritingContract: async ({ event }) => {
        if (isDeliberationPublicationSignal(event)) return fixedConversationStatusWritingContract;
        if (
          modeResponder !== null &&
          (await modeResponder.usesFixedDiscussionPublicationContract(event))
        ) {
          return fixedConversationStatusWritingContract;
        }
        return conversationPublicationWritingContract({
          mode: modeResponder === null ? null : await modeResponder.mode(event),
          independentReadEvaluation: config.routing?.evaluation !== undefined,
          managedPlatformActionResult:
            modeResponder !== null &&
            (await modeResponder.usesManagedActionResultPublicationContract(event)),
        });
      },
    }),
    terminalFailureResponder: new FixedConversationTerminalFailureResponder({
      artifactStore: artifacts,
    }),
    terminalFailurePublicationVerifier: new VerifiedConversationPublication({
      artifactStore: artifacts,
      resolveWritingContract: () => fixedConversationStatusWritingContract,
    }),
    responseFailureClassifier: new NodeConversationResponseFailureClassifier(options.onError),
    async close(): Promise<void> {
      await closeRequestedRuntimes();
      readRuntime?.close();
      repositoryWork?.responder.close();
      intentStore?.close();
      discussionRuntime.close();
    },
  };
}
