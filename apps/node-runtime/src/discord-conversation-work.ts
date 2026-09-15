import type { ConversationResponder } from "@lervo/interaction";
import type { ArtifactStore } from "@lervo/storage-contract";

import { openDiscordConversationRepositoryWork } from "./discord-conversation-repository-work.js";
import type { DiscordGoalIntakeOutcomes } from "./discord-goal-intake-outcomes.js";
import { DiscordSupervisionWorkResponder } from "./discord-supervision-work-responder.js";
import type { DiscordAgentParticipation } from "./discord-agent-participation.js";
import type { NodeDiscordConversationRuntimeOptions } from "./discord-conversation-runtime-types.js";

/** Selects one work route for an installed speaker while retaining the hire/session store. */
export function openDiscordConversationWork(input: {
  options: NodeDiscordConversationRuntimeOptions;
  artifacts: ArtifactStore;
  participation: DiscordAgentParticipation;
  policyId: string;
  authorizedEffectRequesters: readonly {
    participantId: string;
    roleId: string;
    conversationId: string;
  }[];
  intakeOutcomes: DiscordGoalIntakeOutcomes;
}) {
  const { options, participation, artifacts } = input;
  const config = options.config;
  if (config.routing === undefined) return { repositoryWork: null, workResponder: null };
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
          speaker: {
            participantId: config.agentParticipantId,
            roleId: participation.roleId,
            ...(participation.agentBinding === undefined
              ? {}
              : { agentBinding: participation.agentBinding }),
          },
          authorizedEffectRequesters: input.authorizedEffectRequesters,
          intakeOutcomes: input.intakeOutcomes,
          ...(options.supervisionControl === undefined
            ? {}
            : { onRebound: (binding) => options.supervisionControl!.onRebound(binding) }),
        })
      : null;
  // Only an authenticated /goal enters supervised intake; ordinary work keeps the managed route.
  const workResponder: ConversationResponder =
    supervision === null
      ? repositoryWork.responder
      : {
          respond: (input) =>
            input.event.kind === "goal.requested"
              ? supervision.respond(input)
              : repositoryWork.responder.respond(input),
        };
  return { repositoryWork, workResponder };
}
