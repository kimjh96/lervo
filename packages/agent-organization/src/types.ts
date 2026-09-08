import type {
  OrganizationAgentMembershipChangedEventPayload,
  OrganizationAgentIdentityChangedEventPayload,
  OrganizationChannelMembershipChangedEventPayload,
  OrganizationDeliberationParticipantBoundEventPayload,
  OrganizationDeliberationParticipantReleasedEventPayload,
  OrganizationExternalAgentDeploymentBoundEventPayload,
  OrganizationExternalAgentDeploymentRetiredEventPayload,
  OrganizationTeamBoundEventPayload,
  OrganizationTeamKindChangedEventPayload,
} from "@lervo/schemas";

export type AgentOrganizationEvent =
  | { type: "organization.team.bound"; payload: OrganizationTeamBoundEventPayload }
  | {
      type: "organization.team.kind.changed";
      payload: OrganizationTeamKindChangedEventPayload;
    }
  | {
      type: "organization.agent.membership.changed";
      payload: OrganizationAgentMembershipChangedEventPayload;
    }
  | {
      type: "organization.agent.identity.changed";
      payload: OrganizationAgentIdentityChangedEventPayload;
    }
  | {
      type: "organization.external_agent.deployment.bound";
      payload: OrganizationExternalAgentDeploymentBoundEventPayload;
    }
  | {
      type: "organization.external_agent.deployment.retired";
      payload: OrganizationExternalAgentDeploymentRetiredEventPayload;
    }
  | {
      type: "organization.channel.membership.changed";
      payload: OrganizationChannelMembershipChangedEventPayload;
    }
  | {
      type: "organization.deliberation.participant.bound";
      payload: OrganizationDeliberationParticipantBoundEventPayload;
    }
  | {
      type: "organization.deliberation.participant.released";
      payload: OrganizationDeliberationParticipantReleasedEventPayload;
    };

export interface AgentOrganizationEventEnvelope {
  projectId: string;
  seq: number;
  type: string;
  payload: unknown;
}

export interface ExternalAgentDeployment extends OrganizationExternalAgentDeploymentBoundEventPayload {
  retiredAt: string | null;
  retirementReasonCode: string | null;
}

export interface DeliberationParticipantBinding extends OrganizationDeliberationParticipantBoundEventPayload {
  releasedAt: string | null;
  outcomeId: string | null;
  outcomeStatus: "converged" | "no_consensus" | "failed" | "cancelled" | null;
}

export interface AgentOrganizationProjection {
  schemaVersion: 1;
  projectId: string;
  team: OrganizationTeamBoundEventPayload | null;
  teamKindRevision: number;
  memberships: OrganizationAgentMembershipChangedEventPayload[];
  deployments: ExternalAgentDeployment[];
  channelMemberships: OrganizationChannelMembershipChangedEventPayload[];
  deliberationParticipants: DeliberationParticipantBinding[];
  lastSequence: number;
}

export class AgentOrganizationError extends Error {
  constructor(
    readonly code:
      | "organization_event_invalid"
      | "organization_identity_conflict"
      | "organization_state_conflict",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentOrganizationError";
  }
}
