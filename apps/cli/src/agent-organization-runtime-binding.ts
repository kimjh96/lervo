import {
  organizationIdentityHash,
  type AgentOrganizationProjection,
} from "@lervo/agent-organization";
import { listAgents, type WorkforceAgent } from "@lervo/agent-workforce";
import { configuredDiscordConversations, type NodeRuntimeConfig } from "@lervo/node-runtime";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";

import { mutateAgentOrganization } from "./agent-organization-mutation.js";
import { bindDiscordAgentDeployment } from "./agent-organization-deployment-binding.js";
import {
  appendOrganizationEvent,
  organizationPolicyHash,
  projectOrganization,
} from "./agent-organization-event-mutation.js";

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

function bindTeam(input: {
  storage: ProjectStorage;
  organizationId: string;
  teamId: string;
  teamKind: "central" | "project";
}): void {
  const current = projectOrganization(input.storage);
  if (current.team === null) {
    appendOrganizationEvent(input.storage, "organization.team.bound", {
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
  const current = projectOrganization(input.storage);
  if (
    current.team === null ||
    current.team.organizationId !== input.organizationId ||
    current.team.teamId !== input.teamId
  ) {
    throw new Error("The exact existing organization team must be bound before reclassification.");
  }
  if (current.team.teamKind === input.teamKind) return;
  appendOrganizationEvent(input.storage, "organization.team.kind.changed", {
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

export async function inspectAgentOrganization(root: string): Promise<AgentOrganizationProjection> {
  const storage = await openProjectStorage(root);
  try {
    return projectOrganization(storage);
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
    const current = projectOrganization(storage);
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
      bindDiscordAgentDeployment({
        storage,
        organizationId: input.organizationId,
        teamId: input.teamId,
        config: deployment,
        agent: activeAgent(agents, deployment.agentId),
        occurredAt: new Date().toISOString(),
      });
    }
    return projectOrganization(storage);
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
    return projectOrganization(storage);
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
    return projectOrganization(storage);
  });
}
