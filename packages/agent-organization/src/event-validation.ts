import {
  validateSchema,
  type OrganizationAgentMembershipChangedEventPayload,
  type OrganizationAgentIdentityChangedEventPayload,
  type OrganizationChannelMembershipChangedEventPayload,
  type OrganizationDeliberationParticipantBoundEventPayload,
  type OrganizationDeliberationParticipantReleasedEventPayload,
  type OrganizationExternalAgentDeploymentBoundEventPayload,
  type OrganizationExternalAgentDeploymentRetiredEventPayload,
  type OrganizationTeamBoundEventPayload,
  type OrganizationTeamKindChangedEventPayload,
  type SchemaName,
} from "@lervo/schemas";

import type { AgentOrganizationEvent, AgentOrganizationEventEnvelope } from "./types.js";
import { AgentOrganizationError } from "./types.js";

const schemaByType = {
  "organization.team.bound": "organizationTeamBoundEventPayload",
  "organization.team.kind.changed": "organizationTeamKindChangedEventPayload",
  "organization.agent.membership.changed": "organizationAgentMembershipChangedEventPayload",
  "organization.agent.identity.changed": "organizationAgentIdentityChangedEventPayload",
  "organization.external_agent.deployment.bound":
    "organizationExternalAgentDeploymentBoundEventPayload",
  "organization.external_agent.deployment.retired":
    "organizationExternalAgentDeploymentRetiredEventPayload",
  "organization.channel.membership.changed": "organizationChannelMembershipChangedEventPayload",
  "organization.deliberation.participant.bound":
    "organizationDeliberationParticipantBoundEventPayload",
  "organization.deliberation.participant.released":
    "organizationDeliberationParticipantReleasedEventPayload",
} as const satisfies Record<AgentOrganizationEvent["type"], SchemaName>;

export function isAgentOrganizationEventType(type: string): type is AgentOrganizationEvent["type"] {
  return Object.hasOwn(schemaByType, type);
}

export function organizationEvent(
  envelope: AgentOrganizationEventEnvelope,
): AgentOrganizationEvent | null {
  if (!isAgentOrganizationEventType(envelope.type)) return null;
  if (!validateSchema(schemaByType[envelope.type], envelope.payload).valid) {
    throw new AgentOrganizationError(
      "organization_event_invalid",
      `The ${envelope.type} payload is invalid.`,
    );
  }
  switch (envelope.type) {
    case "organization.team.bound":
      return {
        type: envelope.type,
        payload: envelope.payload as OrganizationTeamBoundEventPayload,
      };
    case "organization.team.kind.changed":
      return {
        type: envelope.type,
        payload: envelope.payload as OrganizationTeamKindChangedEventPayload,
      };
    case "organization.agent.membership.changed":
      return {
        type: envelope.type,
        payload: envelope.payload as OrganizationAgentMembershipChangedEventPayload,
      };
    case "organization.agent.identity.changed":
      return {
        type: envelope.type,
        payload: envelope.payload as OrganizationAgentIdentityChangedEventPayload,
      };
    case "organization.external_agent.deployment.bound":
      return {
        type: envelope.type,
        payload: envelope.payload as OrganizationExternalAgentDeploymentBoundEventPayload,
      };
    case "organization.external_agent.deployment.retired":
      return {
        type: envelope.type,
        payload: envelope.payload as OrganizationExternalAgentDeploymentRetiredEventPayload,
      };
    case "organization.channel.membership.changed":
      return {
        type: envelope.type,
        payload: envelope.payload as OrganizationChannelMembershipChangedEventPayload,
      };
    case "organization.deliberation.participant.bound":
      return {
        type: envelope.type,
        payload: envelope.payload as OrganizationDeliberationParticipantBoundEventPayload,
      };
    case "organization.deliberation.participant.released":
      return {
        type: envelope.type,
        payload: envelope.payload as OrganizationDeliberationParticipantReleasedEventPayload,
      };
  }
}
