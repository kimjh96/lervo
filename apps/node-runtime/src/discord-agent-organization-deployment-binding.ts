import {
  externalAgentPrincipalHash,
  externalConversationKeyHash,
  workforceProviderPolicyHash,
} from "@lervo/agent-organization";
import type { WorkforceAgent } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";

import {
  appendOrganizationEvent,
  organizationCoordinate,
  projectOrganization,
} from "./agent-organization-event-mutation.js";
import type { NodeDiscordConversationConfig } from "./config-types.js";
import { discordDeploymentConfigHashes } from "./discord-agent-organization.js";
import { discordSpeakerPrincipalId } from "./discord-conversation-speaker.js";

function conversationIdentity(config: NodeDiscordConversationConfig) {
  return config.conversations.map((item) => ({
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
}

function retireDeployment(input: {
  storage: ProjectStorage;
  deploymentId: string;
  occurredAt: string;
  reasonCode: string;
}): void {
  const current = projectOrganization(input.storage);
  const deployment = current.deployments.find((item) => item.deploymentId === input.deploymentId);
  if (deployment === undefined || deployment.retiredAt !== null) return;
  for (const channel of current.channelMemberships.filter(
    (item) => item.deploymentId === deployment.deploymentId && item.status === "active",
  )) {
    appendOrganizationEvent(input.storage, "organization.channel.membership.changed", {
      ...channel,
      previousStatus: "active",
      status: "ended",
      revision: channel.revision + 1,
      changedAt: input.occurredAt,
    });
  }
  appendOrganizationEvent(input.storage, "organization.external_agent.deployment.retired", {
    deploymentId: deployment.deploymentId,
    organizationId: deployment.organizationId,
    teamId: deployment.teamId,
    projectId: deployment.projectId,
    membershipId: deployment.membershipId,
    agentId: deployment.agentId,
    reasonCode: input.reasonCode,
    retiredAt: input.occurredAt,
  });
}

function synchronizeMembership(input: {
  storage: ProjectStorage;
  organizationId: string;
  teamId: string;
  agent: WorkforceAgent;
  occurredAt: string;
}) {
  const providerPolicyHash = workforceProviderPolicyHash(input.agent.provider);
  const role = {
    agentDisplayName: input.agent.displayName,
    agentDisplayNameSource: input.agent.displayNameSource,
    roleId: input.agent.roleId,
    roleVersion: input.agent.roleVersion,
    roleContractHash: input.agent.roleContractHash,
    roleProfileHash: input.agent.roleProfileHash,
    providerPolicyHash,
  };
  const membershipId = organizationCoordinate("amem", {
    organizationId: input.organizationId,
    teamId: input.teamId,
    agentId: input.agent.agentId,
  });
  const currentMembership = projectOrganization(input.storage).memberships.find(
    (item) => item.membershipId === membershipId,
  );
  let replacedDeploymentId: string | null = null;
  if (currentMembership === undefined) {
    appendOrganizationEvent(input.storage, "organization.agent.membership.changed", {
      membershipId,
      organizationId: input.organizationId,
      teamId: input.teamId,
      projectId: input.storage.manifest.projectId,
      agentId: input.agent.agentId,
      ...role,
      displayNameRevision: 1,
      previousStatus: null,
      status: "active",
      revision: 1,
      changedAt: input.occurredAt,
    });
  } else {
    if (currentMembership.status !== "active") {
      throw new Error("The existing organization membership is not active.");
    }
    if (
      currentMembership.agentDisplayName !== input.agent.displayName ||
      currentMembership.agentDisplayNameSource !== input.agent.displayNameSource
    ) {
      appendOrganizationEvent(input.storage, "organization.agent.identity.changed", {
        membershipId,
        organizationId: input.organizationId,
        teamId: input.teamId,
        projectId: input.storage.manifest.projectId,
        agentId: input.agent.agentId,
        previousDisplayName: currentMembership.agentDisplayName ?? null,
        displayName: input.agent.displayName,
        displayNameSource: input.agent.displayNameSource,
        revision: (currentMembership.displayNameRevision ?? 0) + 1,
        changedAt: input.occurredAt,
      });
    }
    const synchronizedIdentity = projectOrganization(input.storage).memberships.find(
      (item) => item.membershipId === membershipId,
    )!;
    const roleChanged =
      synchronizedIdentity.roleId !== role.roleId ||
      synchronizedIdentity.roleVersion !== role.roleVersion ||
      synchronizedIdentity.roleContractHash !== role.roleContractHash ||
      synchronizedIdentity.roleProfileHash !== role.roleProfileHash ||
      synchronizedIdentity.providerPolicyHash !== role.providerPolicyHash;
    if (roleChanged) {
      const activeDeployments = projectOrganization(input.storage).deployments.filter(
        (item) => item.membershipId === membershipId && item.retiredAt === null,
      );
      for (const deployment of activeDeployments) {
        retireDeployment({
          storage: input.storage,
          deploymentId: deployment.deploymentId,
          occurredAt: input.occurredAt,
          reasonCode: "configuration_replaced",
        });
      }
      replacedDeploymentId = activeDeployments.at(-1)?.deploymentId ?? null;
      appendOrganizationEvent(input.storage, "organization.agent.membership.changed", {
        membershipId,
        organizationId: input.organizationId,
        teamId: input.teamId,
        projectId: input.storage.manifest.projectId,
        agentId: input.agent.agentId,
        ...role,
        displayNameRevision: synchronizedIdentity.displayNameRevision ?? 1,
        previousStatus: "active",
        status: "active",
        revision: synchronizedIdentity.revision + 1,
        changedAt: input.occurredAt,
      });
    }
  }
  const synchronized = projectOrganization(input.storage).memberships.find(
    (item) => item.membershipId === membershipId,
  )!;
  if (
    synchronized.status !== "active" ||
    synchronized.roleId !== role.roleId ||
    synchronized.roleVersion !== role.roleVersion ||
    synchronized.roleContractHash !== role.roleContractHash ||
    synchronized.roleProfileHash !== role.roleProfileHash ||
    synchronized.providerPolicyHash !== role.providerPolicyHash ||
    synchronized.agentDisplayName !== role.agentDisplayName ||
    synchronized.agentDisplayNameSource !== role.agentDisplayNameSource
  ) {
    throw new Error("The existing organization membership does not match the active agent role.");
  }
  return { membership: synchronized, role, replacedDeploymentId };
}

export function bindDiscordAgentDeployment(input: {
  storage: ProjectStorage;
  organizationId: string;
  teamId: string;
  config: NodeDiscordConversationConfig;
  agent: WorkforceAgent;
  occurredAt: string;
}): void {
  const { membership, role, replacedDeploymentId } = synchronizeMembership(input);
  const conversations = conversationIdentity(input.config);
  // ADR-0612: binding writes the hash without the response model; a deployment that still
  // carries the earlier hash of this configuration is replaced by one with the new hash.
  const { deploymentConfigHash } = discordDeploymentConfigHashes({
    config: input.config,
    agent: input.agent,
    conversations,
  });
  const externalPrincipalHash = externalAgentPrincipalHash(
    "discord",
    discordSpeakerPrincipalId(input.config),
  );
  const currentDeployments = projectOrganization(input.storage).deployments;
  const principalDeployment = currentDeployments.find(
    (item) =>
      item.retiredAt === null &&
      item.platform === "discord" &&
      item.externalPrincipalHash === externalPrincipalHash,
  );
  if (
    principalDeployment !== undefined &&
    (principalDeployment.agentId !== input.agent.agentId ||
      principalDeployment.membershipId !== membership.membershipId ||
      principalDeployment.participantId !== input.config.agentParticipantId)
  ) {
    throw new Error("The Discord principal is already bound to another active agent.");
  }
  const participantDeployment = currentDeployments.find(
    (item) =>
      item.retiredAt === null &&
      item.platform === "discord" &&
      item.participantId === input.config.agentParticipantId,
  );
  if (
    participantDeployment !== undefined &&
    (participantDeployment.agentId !== input.agent.agentId ||
      participantDeployment.membershipId !== membership.membershipId)
  ) {
    throw new Error("The Discord participant is already bound to another active agent.");
  }
  const activeDeployment = principalDeployment ?? participantDeployment;
  if (
    activeDeployment !== undefined &&
    (activeDeployment.externalPrincipalHash !== externalPrincipalHash ||
      activeDeployment.deploymentConfigHash !== deploymentConfigHash)
  ) {
    retireDeployment({
      storage: input.storage,
      deploymentId: activeDeployment.deploymentId,
      occurredAt: input.occurredAt,
      reasonCode: "configuration_replaced",
    });
  }
  const exactActiveDeployment = projectOrganization(input.storage).deployments.find(
    (item) =>
      item.retiredAt === null &&
      item.externalPrincipalHash === externalPrincipalHash &&
      item.deploymentConfigHash === deploymentConfigHash,
  );
  const deploymentId =
    exactActiveDeployment?.deploymentId ??
    organizationCoordinate("adep", {
      organizationId: input.organizationId,
      teamId: input.teamId,
      agentId: input.agent.agentId,
      platform: "discord",
      externalPrincipalHash,
      deploymentConfigHash,
      membershipRevision: membership.revision,
      replacesDeploymentId: activeDeployment?.deploymentId ?? replacedDeploymentId,
    });
  if (exactActiveDeployment === undefined) {
    appendOrganizationEvent(input.storage, "organization.external_agent.deployment.bound", {
      deploymentId,
      organizationId: input.organizationId,
      teamId: input.teamId,
      projectId: input.storage.manifest.projectId,
      membershipId: membership.membershipId,
      agentId: input.agent.agentId,
      participantId: input.config.agentParticipantId,
      ...role,
      displayNameRevision: membership.displayNameRevision ?? 1,
      platform: "discord",
      integrationId: input.config.integrationId,
      externalPrincipalHash,
      deploymentConfigHash,
      boundAt: input.occurredAt,
    });
  }
  for (const conversation of conversations) {
    const channelMembershipId = organizationCoordinate("cmem", {
      deploymentId,
      conversationId: conversation.conversationId,
    });
    const currentChannel = projectOrganization(input.storage).channelMemberships.find(
      (item) => item.channelMembershipId === channelMembershipId,
    );
    if (currentChannel === undefined) {
      appendOrganizationEvent(input.storage, "organization.channel.membership.changed", {
        channelMembershipId,
        deploymentId,
        organizationId: input.organizationId,
        teamId: input.teamId,
        projectId: input.storage.manifest.projectId,
        membershipId: membership.membershipId,
        agentId: input.agent.agentId,
        participantId: input.config.agentParticipantId,
        platform: "discord",
        integrationId: input.config.integrationId,
        ...conversation,
        previousStatus: null,
        status: "active",
        revision: 1,
        changedAt: input.occurredAt,
      });
    } else if (currentChannel.status !== "active") {
      throw new Error("The Discord channel membership has already ended.");
    }
  }
}

export function deactivateDiscordAgentDeployment(input: {
  storage: ProjectStorage;
  agent: WorkforceAgent;
  occurredAt: string;
}): void {
  const current = projectOrganization(input.storage);
  for (const deployment of current.deployments.filter(
    (item) => item.agentId === input.agent.agentId && item.retiredAt === null,
  )) {
    retireDeployment({
      storage: input.storage,
      deploymentId: deployment.deploymentId,
      occurredAt: input.occurredAt,
      reasonCode: "agent_retired",
    });
  }
  const membership = projectOrganization(input.storage).memberships.find(
    (item) => item.agentId === input.agent.agentId && item.status !== "ended",
  );
  if (membership === undefined) return;
  if (membership.status === "ended") return;
  appendOrganizationEvent(input.storage, "organization.agent.membership.changed", {
    ...membership,
    previousStatus: membership.status,
    status: "ended",
    revision: membership.revision + 1,
    changedAt: input.occurredAt,
  });
}
