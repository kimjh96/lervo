import type {
  OrganizationAgentMembershipChangedEventPayload,
  OrganizationChannelMembershipChangedEventPayload,
} from "@lervo/schemas";

import { organizationEvent } from "./event-validation.js";
import { applyAgentIdentity } from "./agent-identity-projection.js";
import {
  AgentOrganizationError,
  type AgentOrganizationEventEnvelope,
  type AgentOrganizationProjection,
} from "./types.js";

function conflict(message: string): never {
  throw new AgentOrganizationError("organization_state_conflict", message);
}

function sameTeam(
  item: { organizationId: string; teamId: string; projectId: string },
  projection: AgentOrganizationProjection,
): boolean {
  return (
    projection.team !== null &&
    item.organizationId === projection.team.organizationId &&
    item.teamId === projection.team.teamId &&
    item.projectId === projection.projectId
  );
}

function sameRole(
  left: {
    agentDisplayName?: string;
    agentDisplayNameSource?: string;
    displayNameRevision?: number;
    roleId: string;
    roleVersion: string;
    roleContractHash: string;
    roleProfileHash: string;
    providerPolicyHash: string;
  },
  right: typeof left,
): boolean {
  return (
    (left.agentDisplayName === undefined ||
      right.agentDisplayName === undefined ||
      (left.agentDisplayName === right.agentDisplayName &&
        left.agentDisplayNameSource === right.agentDisplayNameSource &&
        left.displayNameRevision === right.displayNameRevision)) &&
    left.roleId === right.roleId &&
    left.roleVersion === right.roleVersion &&
    left.roleContractHash === right.roleContractHash &&
    left.roleProfileHash === right.roleProfileHash &&
    left.providerPolicyHash === right.providerPolicyHash
  );
}

function applyMembership(
  projection: AgentOrganizationProjection,
  payload: OrganizationAgentMembershipChangedEventPayload,
): void {
  if (!sameTeam(payload, projection)) conflict("The agent membership belongs to another team.");
  const index = projection.memberships.findIndex(
    (item) => item.membershipId === payload.membershipId,
  );
  if (index < 0) {
    if (payload.previousStatus !== null || payload.status !== "active" || payload.revision !== 1) {
      conflict("A new agent membership must start active at revision one.");
    }
    if (
      projection.memberships.some(
        (item) => item.agentId === payload.agentId && item.status !== "ended",
      )
    ) {
      conflict("An agent already has an active membership in this team.");
    }
    projection.memberships.push(structuredClone(payload));
    return;
  }
  const current = projection.memberships[index]!;
  if (
    current.status === "ended" ||
    payload.agentId !== current.agentId ||
    payload.organizationId !== current.organizationId ||
    payload.teamId !== current.teamId ||
    payload.projectId !== current.projectId ||
    payload.previousStatus !== current.status ||
    payload.revision !== current.revision + 1
  ) {
    conflict("The agent membership transition is stale or changes immutable identity.");
  }
  projection.memberships[index] = structuredClone(payload);
}

function activeMembership(
  projection: AgentOrganizationProjection,
  membershipId: string,
  agentId: string,
) {
  const membership = projection.memberships.find((item) => item.membershipId === membershipId);
  if (
    membership === undefined ||
    membership.status !== "active" ||
    membership.agentId !== agentId
  ) {
    conflict("The operation requires the exact active agent membership.");
  }
  return membership;
}

function applyChannelMembership(
  projection: AgentOrganizationProjection,
  payload: OrganizationChannelMembershipChangedEventPayload,
): void {
  if (!sameTeam(payload, projection)) conflict("The channel membership belongs to another team.");
  const index = projection.channelMemberships.findIndex(
    (item) => item.channelMembershipId === payload.channelMembershipId,
  );
  if (index < 0) {
    if (payload.previousStatus !== null || payload.status !== "active" || payload.revision !== 1) {
      conflict("A new channel membership must start active at revision one.");
    }
    const deployment = projection.deployments.find(
      (item) => item.deploymentId === payload.deploymentId,
    );
    if (
      deployment === undefined ||
      deployment.retiredAt !== null ||
      deployment.membershipId !== payload.membershipId ||
      deployment.agentId !== payload.agentId ||
      deployment.participantId !== payload.participantId ||
      deployment.platform !== payload.platform ||
      deployment.integrationId !== payload.integrationId
    ) {
      conflict("The channel membership does not match an active external-agent deployment.");
    }
    if (
      projection.channelMemberships.some(
        (item) =>
          item.status === "active" &&
          item.deploymentId === payload.deploymentId &&
          item.conversationId === payload.conversationId,
      )
    ) {
      conflict("The deployment already has an active membership in this conversation.");
    }
    activeMembership(projection, payload.membershipId, payload.agentId);
    projection.channelMemberships.push(structuredClone(payload));
    return;
  }
  const current = projection.channelMemberships[index]!;
  if (
    current.status !== "active" ||
    payload.previousStatus !== "active" ||
    payload.status !== "ended" ||
    payload.revision !== current.revision + 1 ||
    payload.deploymentId !== current.deploymentId ||
    payload.agentId !== current.agentId ||
    payload.participantId !== current.participantId ||
    payload.conversationId !== current.conversationId
  ) {
    conflict("The channel membership transition is stale or changes immutable identity.");
  }
  projection.channelMemberships[index] = structuredClone(payload);
}

export function projectAgentOrganization(input: {
  projectId: string;
  events: readonly AgentOrganizationEventEnvelope[];
}): AgentOrganizationProjection {
  const projection: AgentOrganizationProjection = {
    schemaVersion: 1,
    projectId: input.projectId,
    team: null,
    teamKindRevision: 0,
    memberships: [],
    deployments: [],
    channelMemberships: [],
    deliberationParticipants: [],
    lastSequence: 0,
  };
  for (const envelope of input.events) {
    const event = organizationEvent(envelope);
    if (event === null) continue;
    if (
      envelope.projectId !== input.projectId ||
      !Number.isSafeInteger(envelope.seq) ||
      envelope.seq <= projection.lastSequence
    ) {
      throw new AgentOrganizationError(
        "organization_event_invalid",
        "Organization events must use the project event order and identity.",
      );
    }
    projection.lastSequence = envelope.seq;
    switch (event.type) {
      case "organization.team.bound": {
        const payload = event.payload;
        if (payload.projectId !== input.projectId || projection.team !== null) {
          conflict("A repository can have only one immutable project-team binding.");
        }
        projection.team = structuredClone(payload);
        projection.teamKindRevision = 1;
        break;
      }
      case "organization.team.kind.changed": {
        const payload = event.payload;
        if (
          projection.team === null ||
          payload.organizationId !== projection.team.organizationId ||
          payload.teamId !== projection.team.teamId ||
          payload.projectId !== projection.team.projectId ||
          payload.repositoryIdentityHash !== projection.team.repositoryIdentityHash ||
          payload.previousTeamKind !== projection.team.teamKind ||
          payload.teamKind === payload.previousTeamKind ||
          payload.revision !== projection.teamKindRevision + 1
        ) {
          conflict("The team-kind transition is stale or changes immutable identity.");
        }
        projection.team = { ...projection.team, teamKind: payload.teamKind };
        projection.teamKindRevision = payload.revision;
        break;
      }
      case "organization.agent.membership.changed":
        applyMembership(projection, event.payload);
        break;
      case "organization.agent.identity.changed":
        applyAgentIdentity(projection, event.payload);
        break;
      case "organization.external_agent.deployment.bound": {
        const payload = event.payload;
        if (!sameTeam(payload, projection)) conflict("The deployment belongs to another team.");
        const membership = activeMembership(projection, payload.membershipId, payload.agentId);
        if (!sameRole(payload, membership)) {
          conflict("The deployment does not preserve the membership role and provider policy.");
        }
        if (
          projection.deployments.some(
            (item) =>
              item.deploymentId === payload.deploymentId ||
              (item.retiredAt === null &&
                (item.participantId === payload.participantId ||
                  (item.platform === payload.platform &&
                    item.externalPrincipalHash === payload.externalPrincipalHash))),
          )
        ) {
          conflict("An active external principal or participant cannot represent two agents.");
        }
        projection.deployments.push({
          ...structuredClone(payload),
          retiredAt: null,
          retirementReasonCode: null,
        });
        break;
      }
      case "organization.external_agent.deployment.retired": {
        const payload = event.payload;
        if (!sameTeam(payload, projection)) conflict("The deployment belongs to another team.");
        const index = projection.deployments.findIndex(
          (item) => item.deploymentId === payload.deploymentId,
        );
        const deployment = projection.deployments[index];
        if (
          deployment === undefined ||
          deployment.retiredAt !== null ||
          deployment.membershipId !== payload.membershipId ||
          deployment.agentId !== payload.agentId ||
          projection.channelMemberships.some(
            (item) => item.deploymentId === payload.deploymentId && item.status === "active",
          )
        ) {
          conflict("A deployment can retire only after all channel memberships end.");
        }
        projection.deployments[index] = {
          ...deployment,
          retiredAt: payload.retiredAt,
          retirementReasonCode: payload.reasonCode,
        };
        break;
      }
      case "organization.channel.membership.changed":
        applyChannelMembership(projection, event.payload);
        break;
      case "organization.deliberation.participant.bound": {
        const payload = event.payload;
        if (!sameTeam(payload, projection)) {
          conflict("The deliberation participant belongs to another team.");
        }
        const membership = activeMembership(projection, payload.membershipId, payload.agentId);
        if (!sameRole(payload, membership)) {
          conflict("The deliberation participant does not preserve the membership role.");
        }
        if (payload.deploymentId !== null) {
          const deployment = projection.deployments.find(
            (item) => item.deploymentId === payload.deploymentId,
          );
          if (
            deployment === undefined ||
            deployment.retiredAt !== null ||
            deployment.membershipId !== payload.membershipId ||
            deployment.participantId !== payload.participantId
          ) {
            conflict("The deliberation participant has no matching active deployment.");
          }
        }
        if (payload.channelMembershipId !== null) {
          const channel = projection.channelMemberships.find(
            (item) => item.channelMembershipId === payload.channelMembershipId,
          );
          if (
            channel === undefined ||
            channel.status !== "active" ||
            channel.deploymentId !== payload.deploymentId ||
            channel.participantId !== payload.participantId
          ) {
            conflict("The deliberation participant has no matching active channel membership.");
          }
        }
        if (
          projection.deliberationParticipants.some(
            (item) =>
              item.releasedAt === null &&
              item.deliberationId === payload.deliberationId &&
              (item.agentId === payload.agentId || item.participantId === payload.participantId),
          )
        ) {
          conflict("The agent is already bound to this deliberation.");
        }
        projection.deliberationParticipants.push({
          ...structuredClone(payload),
          releasedAt: null,
          outcomeId: null,
          outcomeStatus: null,
        });
        break;
      }
      case "organization.deliberation.participant.released": {
        const payload = event.payload;
        if (!sameTeam(payload, projection)) {
          conflict("The deliberation participant belongs to another team.");
        }
        const index = projection.deliberationParticipants.findIndex(
          (item) =>
            item.deliberationId === payload.deliberationId &&
            item.agentId === payload.agentId &&
            item.participantId === payload.participantId &&
            item.releasedAt === null,
        );
        const participant = projection.deliberationParticipants[index];
        if (
          participant === undefined ||
          (payload.status === "cancelled" ? payload.outcomeId !== null : payload.outcomeId === null)
        ) {
          conflict("The deliberation release does not match an active participant and outcome.");
        }
        projection.deliberationParticipants[index] = {
          ...participant,
          releasedAt: payload.releasedAt,
          outcomeId: payload.outcomeId,
          outcomeStatus: payload.status,
        };
        break;
      }
    }
  }
  projection.memberships.sort((left, right) => left.membershipId.localeCompare(right.membershipId));
  projection.deployments.sort((left, right) => left.deploymentId.localeCompare(right.deploymentId));
  projection.channelMemberships.sort((left, right) =>
    left.channelMembershipId.localeCompare(right.channelMembershipId),
  );
  projection.deliberationParticipants.sort((left, right) =>
    `${left.deliberationId}\0${left.agentId}`.localeCompare(
      `${right.deliberationId}\0${right.agentId}`,
    ),
  );
  return projection;
}
