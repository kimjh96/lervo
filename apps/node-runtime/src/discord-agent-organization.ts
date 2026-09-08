import {
  assertOrganizationRuntimeIdentity,
  externalAgentDeploymentConfigHash,
  externalAgentPrincipalHash,
  externalConversationKeyHash,
  projectAgentOrganizationFromEventSource,
  workforceProviderPolicyHash,
} from "@lervo/agent-organization";
import type { WorkforceAgent } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import { NodeRuntimeError } from "./errors.js";

export async function validateDiscordAgentOrganization(input: {
  repositoryRoot: string;
  config: NodeDiscordConversationConfig;
  agent: WorkforceAgent;
}): Promise<void> {
  if (input.config.organization === undefined) return;
  const conversations = input.config.conversations.map((item) => ({
    tenantKeyHash: externalConversationKeyHash({
      platform: "discord",
      kind: "tenant",
      key: item.tenantKey,
    }),
    conversationKeyHash: externalConversationKeyHash({
      platform: "discord",
      kind: "conversation",
      key: item.conversationKey,
    }),
    conversationId: item.conversationId,
  }));
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const projection = projectAgentOrganizationFromEventSource({
      projectId: storage.manifest.projectId,
      events: storage.events,
    });
    assertOrganizationRuntimeIdentity(projection, {
      ...input.config.organization,
      projectId: storage.manifest.projectId,
      repositoryIdentityHash: calculateProjectIdentityHash(storage.manifest),
      agentId: input.agent.agentId,
      participantId: input.config.agentParticipantId,
      roleId: input.agent.roleId,
      roleVersion: input.agent.roleVersion,
      roleContractHash: input.agent.roleContractHash,
      roleProfileHash: input.agent.roleProfileHash,
      providerPolicyHash: workforceProviderPolicyHash(input.agent.provider),
      platform: "discord",
      integrationId: input.config.integrationId,
      externalPrincipalHash: externalAgentPrincipalHash("discord", input.config.applicationId),
      deploymentConfigHash: externalAgentDeploymentConfigHash({
        platform: "discord",
        integrationId: input.config.integrationId,
        agentId: input.agent.agentId,
        participantId: input.config.agentParticipantId,
        response: {
          provider: input.config.routing?.response.provider ?? input.config.command.provider,
          model: input.config.routing?.response.model ?? null,
        },
        command: {
          provider: input.config.command.provider,
          roleId: input.config.command.roleId,
        },
        conversations,
      }),
      conversations,
    });
  } catch (error) {
    throw new NodeRuntimeError(
      "invalid_config",
      "The Discord runtime does not match its durable organization identity.",
      { cause: error instanceof Error ? error : undefined },
    );
  } finally {
    await storage.close();
  }
}
