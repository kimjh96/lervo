import type { OrganizationAgentIdentityChangedEventPayload } from "@lervo/schemas";

import { AgentOrganizationError, type AgentOrganizationProjection } from "./types.js";

function conflict(message: string): never {
  throw new AgentOrganizationError("organization_state_conflict", message);
}

export function applyAgentIdentity(
  projection: AgentOrganizationProjection,
  payload: OrganizationAgentIdentityChangedEventPayload,
): void {
  if (
    projection.team === null ||
    payload.organizationId !== projection.team.organizationId ||
    payload.teamId !== projection.team.teamId ||
    payload.projectId !== projection.projectId
  ) {
    conflict("The agent identity belongs to another team.");
  }
  const index = projection.memberships.findIndex(
    (item) => item.membershipId === payload.membershipId,
  );
  const current = projection.memberships[index];
  if (
    current === undefined ||
    current.agentId !== payload.agentId ||
    current.status !== "active" ||
    (current.agentDisplayName ?? null) !== payload.previousDisplayName ||
    payload.revision !== (current.displayNameRevision ?? 0) + 1
  ) {
    conflict("The agent display-name transition is stale or changes immutable identity.");
  }
  projection.memberships[index] = {
    ...current,
    agentDisplayName: payload.displayName,
    agentDisplayNameSource: payload.displayNameSource,
    displayNameRevision: payload.revision,
  };
  projection.deployments = projection.deployments.map((deployment) =>
    deployment.agentId === payload.agentId && deployment.retiredAt === null
      ? {
          ...deployment,
          agentDisplayName: payload.displayName,
          agentDisplayNameSource: payload.displayNameSource,
          displayNameRevision: payload.revision,
        }
      : deployment,
  );
}
