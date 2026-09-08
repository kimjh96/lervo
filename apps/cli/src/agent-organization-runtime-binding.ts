import {
  externalAgentDeploymentConfigHash,
  externalAgentPrincipalHash,
  externalConversationKeyHash,
  organizationIdentityHash,
  projectAgentOrganizationFromEventSource,
  workforceProviderPolicyHash,
  type AgentOrganizationEvent,
  type AgentOrganizationProjection,
} from "@lervo/agent-organization";
import { listAgents, type WorkforceAgent } from "@lervo/agent-workforce";
import {
  configuredDiscordConversations,
  type NodeDiscordConversationConfig,
  type NodeRuntimeConfig,
} from "@lervo/node-runtime";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";

import { mutateAgentOrganization } from "./agent-organization-mutation.js";

const organizationPolicyHash = organizationIdentityHash({
  schemaVersion: 1,
  authority: "human_owner",
  crossTeamEffects: "explicit_only",
  repositoryAuthority: "isolated",
});

function teamPolicyHash(projectId: string): string {
  return organizationIdentityHash({
    schemaVersion: 1,
    projectId,
    membership: "explicit",
    externalIdentity: "one_active_deployment_per_principal",
    channelParticipation: "explicit",
    discussion: "bounded",
  });
}

function coordinate(prefix: "amem" | "adep" | "cmem", value: unknown): string {
  return `${prefix}_${organizationIdentityHash(value).slice("sha256:".length, 40)}`;
}

function eventCoordinates(type: string, payload: unknown) {
  const identity = organizationIdentityHash({ type, payload }).slice("sha256:".length, 40);
  return {
    eventId: `evt_${identity}`,
    runId: `run_${identity}`,
    sessionId: `ses_${identity}`,
  };
}

function projection(storage: ProjectStorage): AgentOrganizationProjection {
  return projectAgentOrganizationFromEventSource({
    projectId: storage.manifest.projectId,
    events: storage.events,
  });
}

function append(
  storage: ProjectStorage,
  type: AgentOrganizationEvent["type"],
  payload: Record<string, unknown>,
): void {
  const coordinates = eventCoordinates(type, payload);
  const draft = {
    ...coordinates,
    projectId: storage.manifest.projectId,
    type,
    occurredAt:
      typeof payload.boundAt === "string"
        ? payload.boundAt
        : typeof payload.changedAt === "string"
          ? payload.changedAt
          : new Date().toISOString(),
    actor: { kind: "system" },
    policyVersion: organizationPolicyHash,
    payload,
  } as const;
  storage.events.append(
    storage.writableEventSchemaVersion === 2
      ? { ...draft, schemaVersion: 2 }
      : { ...draft, schemaVersion: 1 },
  );
}

function bindTeam(input: {
  storage: ProjectStorage;
  organizationId: string;
  teamId: string;
  teamKind: "central" | "project";
}): void {
  const current = projection(input.storage);
  if (current.team === null) {
    append(input.storage, "organization.team.bound", {
      organizationId: input.organizationId,
      teamId: input.teamId,
      projectId: input.storage.manifest.projectId,
      repositoryIdentityHash: calculateProjectIdentityHash(input.storage.manifest),
      organizationPolicyHash,
      teamPolicyHash: teamPolicyHash(input.storage.manifest.projectId),
      teamKind: input.teamKind,
      boundAt: new Date().toISOString(),
    });
    return;
  }
  if (
    current.team.organizationId !== input.organizationId ||
    current.team.teamId !== input.teamId ||
    current.team.teamKind !== input.teamKind
  ) {
    throw new Error("The repository is already bound to another organization team.");
  }
}

function changeTeamKind(input: {
  storage: ProjectStorage;
  organizationId: string;
  teamId: string;
  teamKind: "central" | "project";
}): void {
  const current = projection(input.storage);
  if (
    current.team === null ||
    current.team.organizationId !== input.organizationId ||
    current.team.teamId !== input.teamId
  ) {
    throw new Error("The exact existing organization team must be bound before reclassification.");
  }
  if (current.team.teamKind === input.teamKind) return;
  append(input.storage, "organization.team.kind.changed", {
    organizationId: current.team.organizationId,
    teamId: current.team.teamId,
    projectId: current.team.projectId,
    repositoryIdentityHash: current.team.repositoryIdentityHash,
    previousTeamKind: current.team.teamKind,
    teamKind: input.teamKind,
    revision: current.teamKindRevision + 1,
    changedAt: new Date().toISOString(),
  });
}

function activeAgent(agents: readonly WorkforceAgent[], agentId: string): WorkforceAgent {
  const agent = agents.find((item) => item.agentId === agentId);
  if (agent === undefined || agent.status !== "active") {
    throw new Error("Every organization-bound Discord deployment requires an active hired agent.");
  }
  return agent;
}

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

function bindDeployment(input: {
  storage: ProjectStorage;
  organizationId: string;
  teamId: string;
  config: NodeDiscordConversationConfig;
  agent: WorkforceAgent;
  occurredAt: string;
}): void {
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
  const membershipId = coordinate("amem", {
    organizationId: input.organizationId,
    teamId: input.teamId,
    agentId: input.agent.agentId,
  });
  const currentMembership = projection(input.storage).memberships.find(
    (item) => item.membershipId === membershipId,
  );
  if (currentMembership === undefined) {
    append(input.storage, "organization.agent.membership.changed", {
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
    if (
      currentMembership.status === "active" &&
      (currentMembership.agentDisplayName !== input.agent.displayName ||
        currentMembership.agentDisplayNameSource !== input.agent.displayNameSource)
    ) {
      append(input.storage, "organization.agent.identity.changed", {
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
  }
  const synchronizedMembership = projection(input.storage).memberships.find(
    (item) => item.membershipId === membershipId,
  )!;
  if (
    synchronizedMembership.status !== "active" ||
    synchronizedMembership.roleId !== role.roleId ||
    synchronizedMembership.roleVersion !== role.roleVersion ||
    synchronizedMembership.roleContractHash !== role.roleContractHash ||
    synchronizedMembership.roleProfileHash !== role.roleProfileHash ||
    synchronizedMembership.providerPolicyHash !== role.providerPolicyHash ||
    synchronizedMembership.agentDisplayName !== role.agentDisplayName ||
    synchronizedMembership.agentDisplayNameSource !== role.agentDisplayNameSource
  ) {
    throw new Error("The existing organization membership does not match the active agent role.");
  }

  const conversations = conversationIdentity(input.config);
  const deploymentConfigHash = externalAgentDeploymentConfigHash({
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
  });
  const externalPrincipalHash = externalAgentPrincipalHash("discord", input.config.applicationId);
  const deploymentId = coordinate("adep", {
    organizationId: input.organizationId,
    teamId: input.teamId,
    agentId: input.agent.agentId,
    platform: "discord",
    externalPrincipalHash,
  });
  const currentDeployment = projection(input.storage).deployments.find(
    (item) => item.deploymentId === deploymentId,
  );
  if (currentDeployment === undefined) {
    append(input.storage, "organization.external_agent.deployment.bound", {
      deploymentId,
      organizationId: input.organizationId,
      teamId: input.teamId,
      projectId: input.storage.manifest.projectId,
      membershipId,
      agentId: input.agent.agentId,
      participantId: input.config.agentParticipantId,
      ...role,
      displayNameRevision: synchronizedMembership.displayNameRevision ?? 1,
      platform: "discord",
      integrationId: input.config.integrationId,
      externalPrincipalHash,
      deploymentConfigHash,
      boundAt: input.occurredAt,
    });
  } else if (
    currentDeployment.retiredAt !== null ||
    currentDeployment.deploymentConfigHash !== deploymentConfigHash
  ) {
    throw new Error("The Discord principal is already bound to another immutable deployment.");
  }

  for (const conversation of conversations) {
    const channelMembershipId = coordinate("cmem", {
      deploymentId,
      conversationId: conversation.conversationId,
    });
    const currentChannel = projection(input.storage).channelMemberships.find(
      (item) => item.channelMembershipId === channelMembershipId,
    );
    if (currentChannel === undefined) {
      append(input.storage, "organization.channel.membership.changed", {
        channelMembershipId,
        deploymentId,
        organizationId: input.organizationId,
        teamId: input.teamId,
        projectId: input.storage.manifest.projectId,
        membershipId,
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

export async function inspectAgentOrganization(root: string): Promise<AgentOrganizationProjection> {
  const storage = await openProjectStorage(root);
  try {
    return projection(storage);
  } finally {
    await storage.close();
  }
}

export async function bindAgentOrganizationRuntime(input: {
  root: string;
  organizationId: string;
  teamId: string;
  config: NodeRuntimeConfig;
}): Promise<AgentOrganizationProjection> {
  return mutateAgentOrganization(input.root, async (storage) => {
    const current = projection(storage);
    bindTeam({
      storage,
      organizationId: input.organizationId,
      teamId: input.teamId,
      teamKind:
        current.team?.organizationId === input.organizationId &&
        current.team.teamId === input.teamId
          ? current.team.teamKind
          : "project",
    });
    const agents = await listAgents(input.root);
    for (const deployment of configuredDiscordConversations(input.config)) {
      if (deployment.agentId === undefined) {
        throw new Error("Organization runtime binding cannot use an unowned Discord bot.");
      }
      bindDeployment({
        storage,
        organizationId: input.organizationId,
        teamId: input.teamId,
        config: deployment,
        agent: activeAgent(agents, deployment.agentId),
        occurredAt: new Date().toISOString(),
      });
    }
    return projection(storage);
  });
}

export async function changeAgentOrganizationTeamKind(input: {
  root: string;
  organizationId: string;
  teamId: string;
  teamKind: "central" | "project";
}): Promise<AgentOrganizationProjection> {
  return mutateAgentOrganization(input.root, async (storage) => {
    changeTeamKind({ storage, ...input });
    return projection(storage);
  });
}

export async function bindAgentOrganizationTeam(input: {
  root: string;
  organizationId: string;
  teamId: string;
  teamKind: "central" | "project";
}): Promise<AgentOrganizationProjection> {
  return mutateAgentOrganization(input.root, async (storage) => {
    bindTeam({
      storage,
      organizationId: input.organizationId,
      teamId: input.teamId,
      teamKind: input.teamKind,
    });
    return projection(storage);
  });
}
