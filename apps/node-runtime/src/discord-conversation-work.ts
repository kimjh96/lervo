import type { ConversationResponder } from "@lervo/interaction";
import type { ManagedConversationSurfaceEffect } from "@lervo/conversation-responder";
import type { ArtifactStore } from "@lervo/storage-contract";

import { openDiscordConversationRepositoryWork } from "./discord-conversation-repository-work.js";
import { DiscordSupervisionWorkResponder } from "./discord-supervision-work-responder.js";
import type { DiscordAgentParticipation } from "./discord-agent-participation.js";
import type { NodeDiscordConversationRuntimeOptions } from "./discord-conversation-runtime-types.js";

export const supervisionGoalEffect: ManagedConversationSurfaceEffect = {
  effectId: "supervision_goal_request",
  description:
    "Ask the installed owner to accept and govern a durable multi-step outcome across delegation, verification, or multiple turns.",
  argumentDescription: null,
};

/** Selects one work route for an installed speaker while retaining the hire/session store. */
export function openDiscordConversationWork(input: {
  options: NodeDiscordConversationRuntimeOptions;
  artifacts: ArtifactStore;
  participation: DiscordAgentParticipation;
  policyId: string;
  resultResponder: ConversationResponder;
  authorizedEffectRequesters: readonly {
    participantId: string;
    roleId: string;
    conversationId: string;
  }[];
}) {
  const { options, participation, artifacts } = input;
  const config = options.config;
  if (config.routing === undefined)
    return { repositoryWork: null, workResponder: null, goalResponder: null };
  const repositoryWork = openDiscordConversationRepositoryWork({
    config: { ...config, routing: config.routing },
    repositoryRoot: options.repositoryRoot,
    ...(options.repositoryReplica === undefined
      ? {}
      : { repositoryReplica: options.repositoryReplica }),
    dataDirectory: options.dataDirectory,
    artifactStore: artifacts,
    parentAgentId: participation.agentId ?? config.agentParticipantId,
    ...(options.runtimeConfigPath === undefined
      ? {}
      : { runtimeConfigPath: options.runtimeConfigPath }),
    authorizedEffectRequesters: input.authorizedEffectRequesters,
    ...(options.providerExecutables === undefined
      ? {}
      : { providerExecutables: options.providerExecutables }),
    ...(options.providerModels === undefined ? {} : { providerModels: options.providerModels }),
    ...(options.providerReasoningEfforts === undefined
      ? {}
      : { providerReasoningEfforts: options.providerReasoningEfforts }),
    ...(options.providerExecutionProfiles === undefined
      ? {}
      : { providerExecutionProfiles: options.providerExecutionProfiles }),
    ...(options.repositoryWorkExecutor === undefined
      ? {}
      : { executor: options.repositoryWorkExecutor }),
  });
  const supervision =
    options.outcomeSupervision?.binding.ownerAgentId === participation.agentId
      ? new DiscordSupervisionWorkResponder({
          repositoryRoot: options.repositoryRoot,
          projectId: options.project.projectId,
          artifactStore: artifacts,
          configuration: options.outcomeSupervision,
          policyId: input.policyId,
          resultResponder: input.resultResponder,
          speaker: {
            participantId: config.agentParticipantId,
            roleId: participation.roleId,
            ...(participation.agentBinding === undefined
              ? {}
              : { agentBinding: participation.agentBinding }),
          },
          authorizedEffectRequesters: input.authorizedEffectRequesters,
          ...(options.supervisionControl === undefined
            ? {}
            : { onRebound: (binding) => options.supervisionControl!.onRebound(binding) }),
        })
      : null;
  const workResponder: ConversationResponder = repositoryWork.responder;
  return {
    repositoryWork,
    workResponder,
    goalResponder: supervision,
  };
}
