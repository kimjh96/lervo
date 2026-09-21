import type { FromSchema } from "json-schema-to-ts";

import {
  conversationIdSchema,
  conversationParticipantIdSchema,
  deliberationIdSchema,
  deliberationPolicyIdSchema,
  integrationIdSchema,
  projectIdSchema,
  roleIdSchema,
  semverSchema,
  sha256Schema,
  timestampSchema,
  workforceAgentIdSchema,
} from "./common.js";

const organizationIdSchema = {
  type: "string",
  pattern: "^org_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;
const teamIdSchema = {
  type: "string",
  pattern: "^team_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;
const agentMembershipIdSchema = {
  type: "string",
  pattern: "^amem_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;
const agentDeploymentIdSchema = {
  type: "string",
  pattern: "^adep_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;
const channelMembershipIdSchema = {
  type: "string",
  pattern: "^cmem_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const organizationTeamBoundEventPayloadSchema = {
  type: "object",
  properties: {
    organizationId: organizationIdSchema,
    teamId: teamIdSchema,
    projectId: projectIdSchema,
    repositoryIdentityHash: sha256Schema,
    organizationPolicyHash: sha256Schema,
    teamPolicyHash: sha256Schema,
    teamKind: { type: "string", enum: ["central", "project"] },
    boundAt: timestampSchema,
  },
  required: [
    "organizationId",
    "teamId",
    "projectId",
    "repositoryIdentityHash",
    "organizationPolicyHash",
    "teamPolicyHash",
    "teamKind",
    "boundAt",
  ],
  additionalProperties: false,
} as const;

export const organizationTeamKindChangedEventPayloadSchema = {
  type: "object",
  properties: {
    organizationId: organizationIdSchema,
    teamId: teamIdSchema,
    projectId: projectIdSchema,
    repositoryIdentityHash: sha256Schema,
    previousTeamKind: { type: "string", enum: ["central", "project"] },
    teamKind: { type: "string", enum: ["central", "project"] },
    revision: { type: "integer", minimum: 2 },
    changedAt: timestampSchema,
  },
  required: [
    "organizationId",
    "teamId",
    "projectId",
    "repositoryIdentityHash",
    "previousTeamKind",
    "teamKind",
    "revision",
    "changedAt",
  ],
  additionalProperties: false,
} as const;

export const organizationAgentIdentityChangedEventPayloadSchema = {
  type: "object",
  properties: {
    membershipId: agentMembershipIdSchema,
    organizationId: organizationIdSchema,
    teamId: teamIdSchema,
    projectId: projectIdSchema,
    agentId: workforceAgentIdSchema,
    previousDisplayName: {
      anyOf: [{ type: "string", minLength: 1, maxLength: 40 }, { type: "null" }],
    },
    displayName: { type: "string", minLength: 1, maxLength: 40 },
    displayNameSource: {
      type: "string",
      enum: ["explicit", "generated", "legacy_derived"],
    },
    revision: { type: "integer", minimum: 1 },
    changedAt: timestampSchema,
  },
  required: [
    "membershipId",
    "organizationId",
    "teamId",
    "projectId",
    "agentId",
    "previousDisplayName",
    "displayName",
    "displayNameSource",
    "revision",
    "changedAt",
  ],
  additionalProperties: false,
} as const;

export const organizationAgentMembershipChangedEventPayloadSchema = {
  type: "object",
  properties: {
    membershipId: agentMembershipIdSchema,
    organizationId: organizationIdSchema,
    teamId: teamIdSchema,
    projectId: projectIdSchema,
    agentId: workforceAgentIdSchema,
    agentDisplayName: { type: "string", minLength: 1, maxLength: 40 },
    agentDisplayNameSource: {
      type: "string",
      enum: ["explicit", "generated", "legacy_derived"],
    },
    displayNameRevision: { type: "integer", minimum: 1 },
    roleId: roleIdSchema,
    roleVersion: semverSchema,
    roleContractHash: sha256Schema,
    roleProfileHash: sha256Schema,
    providerPolicyHash: sha256Schema,
    previousStatus: {
      anyOf: [{ type: "string", enum: ["active", "suspended"] }, { type: "null" }],
    },
    status: { type: "string", enum: ["active", "suspended", "ended"] },
    revision: { type: "integer", minimum: 1 },
    changedAt: timestampSchema,
  },
  required: [
    "membershipId",
    "organizationId",
    "teamId",
    "projectId",
    "agentId",
    "roleId",
    "roleVersion",
    "roleContractHash",
    "roleProfileHash",
    "providerPolicyHash",
    "previousStatus",
    "status",
    "revision",
    "changedAt",
  ],
  additionalProperties: false,
} as const;

export const organizationExternalAgentDeploymentBoundEventPayloadSchema = {
  type: "object",
  properties: {
    deploymentId: agentDeploymentIdSchema,
    organizationId: organizationIdSchema,
    teamId: teamIdSchema,
    projectId: projectIdSchema,
    membershipId: agentMembershipIdSchema,
    agentId: workforceAgentIdSchema,
    agentDisplayName: { type: "string", minLength: 1, maxLength: 40 },
    agentDisplayNameSource: {
      type: "string",
      enum: ["explicit", "generated", "legacy_derived"],
    },
    displayNameRevision: { type: "integer", minimum: 1 },
    participantId: conversationParticipantIdSchema,
    roleId: roleIdSchema,
    roleVersion: semverSchema,
    roleContractHash: sha256Schema,
    roleProfileHash: sha256Schema,
    providerPolicyHash: sha256Schema,
    platform: {
      type: "string",
      pattern: "^[a-z][a-z0-9_-]{0,63}$",
    },
    integrationId: integrationIdSchema,
    externalPrincipalHash: sha256Schema,
    deploymentConfigHash: sha256Schema,
    boundAt: timestampSchema,
  },
  required: [
    "deploymentId",
    "organizationId",
    "teamId",
    "projectId",
    "membershipId",
    "agentId",
    "participantId",
    "roleId",
    "roleVersion",
    "roleContractHash",
    "roleProfileHash",
    "providerPolicyHash",
    "platform",
    "integrationId",
    "externalPrincipalHash",
    "deploymentConfigHash",
    "boundAt",
  ],
  additionalProperties: false,
} as const;

export const organizationExternalAgentDeploymentRetiredEventPayloadSchema = {
  type: "object",
  properties: {
    deploymentId: agentDeploymentIdSchema,
    organizationId: organizationIdSchema,
    teamId: teamIdSchema,
    projectId: projectIdSchema,
    membershipId: agentMembershipIdSchema,
    agentId: workforceAgentIdSchema,
    reasonCode: {
      type: "string",
      pattern: "^[a-z][a-z0-9_]{1,63}$",
    },
    retiredAt: timestampSchema,
  },
  required: [
    "deploymentId",
    "organizationId",
    "teamId",
    "projectId",
    "membershipId",
    "agentId",
    "reasonCode",
    "retiredAt",
  ],
  additionalProperties: false,
} as const;

export const organizationChannelMembershipChangedEventPayloadSchema = {
  type: "object",
  properties: {
    channelMembershipId: channelMembershipIdSchema,
    deploymentId: agentDeploymentIdSchema,
    organizationId: organizationIdSchema,
    teamId: teamIdSchema,
    projectId: projectIdSchema,
    membershipId: agentMembershipIdSchema,
    agentId: workforceAgentIdSchema,
    participantId: conversationParticipantIdSchema,
    platform: {
      type: "string",
      pattern: "^[a-z][a-z0-9_-]{0,63}$",
    },
    integrationId: integrationIdSchema,
    tenantKeyHash: sha256Schema,
    conversationKeyHash: sha256Schema,
    conversationId: conversationIdSchema,
    previousStatus: {
      anyOf: [{ type: "string", enum: ["active"] }, { type: "null" }],
    },
    status: { type: "string", enum: ["active", "ended"] },
    revision: { type: "integer", minimum: 1 },
    changedAt: timestampSchema,
  },
  required: [
    "channelMembershipId",
    "deploymentId",
    "organizationId",
    "teamId",
    "projectId",
    "membershipId",
    "agentId",
    "participantId",
    "platform",
    "integrationId",
    "tenantKeyHash",
    "conversationKeyHash",
    "conversationId",
    "previousStatus",
    "status",
    "revision",
    "changedAt",
  ],
  additionalProperties: false,
} as const;

export const organizationDeliberationParticipantBoundEventPayloadSchema = {
  type: "object",
  properties: {
    deliberationId: deliberationIdSchema,
    deliberationPolicyHash: sha256Schema,
    policyId: deliberationPolicyIdSchema,
    organizationId: organizationIdSchema,
    teamId: teamIdSchema,
    projectId: projectIdSchema,
    channelMembershipId: {
      anyOf: [channelMembershipIdSchema, { type: "null" }],
    },
    membershipId: agentMembershipIdSchema,
    deploymentId: {
      anyOf: [agentDeploymentIdSchema, { type: "null" }],
    },
    agentId: workforceAgentIdSchema,
    participantId: conversationParticipantIdSchema,
    roleId: roleIdSchema,
    bindingVersion: { type: "integer", const: 2 },
    participationAssignmentId: {
      type: "string",
      pattern: "^dpa_[a-f0-9]{40}$",
    },
    policyRoleId: roleIdSchema,
    agentRoleId: roleIdSchema,
    roleVersion: semverSchema,
    roleContractHash: sha256Schema,
    roleProfileHash: sha256Schema,
    providerPolicyHash: sha256Schema,
    executionRouteHash: sha256Schema,
    executionProvider: { type: "string", enum: ["codex", "claude"] },
    acceptedAt: timestampSchema,
    boundAt: timestampSchema,
  },
  required: [
    "deliberationId",
    "deliberationPolicyHash",
    "organizationId",
    "teamId",
    "projectId",
    "channelMembershipId",
    "membershipId",
    "deploymentId",
    "agentId",
    "participantId",
    "roleId",
    "roleVersion",
    "roleContractHash",
    "roleProfileHash",
    "providerPolicyHash",
    "boundAt",
  ],
  dependentRequired: {
    bindingVersion: [
      "participationAssignmentId",
      "policyId",
      "policyRoleId",
      "agentRoleId",
      "executionRouteHash",
      "executionProvider",
      "acceptedAt",
    ],
    participationAssignmentId: ["bindingVersion"],
    policyId: ["bindingVersion"],
    policyRoleId: ["bindingVersion"],
    agentRoleId: ["bindingVersion"],
    executionRouteHash: ["bindingVersion"],
    executionProvider: ["bindingVersion"],
    acceptedAt: ["bindingVersion"],
  },
  additionalProperties: false,
} as const;

export const organizationDeliberationParticipantReleasedEventPayloadSchema = {
  type: "object",
  properties: {
    deliberationId: deliberationIdSchema,
    organizationId: organizationIdSchema,
    teamId: teamIdSchema,
    projectId: projectIdSchema,
    agentId: workforceAgentIdSchema,
    participantId: conversationParticipantIdSchema,
    outcomeId: {
      anyOf: [{ type: "string", pattern: "^dlo_[a-f0-9]{16}$" }, { type: "null" }],
    },
    status: { type: "string", enum: ["converged", "no_consensus", "failed", "cancelled"] },
    releasedAt: timestampSchema,
  },
  required: [
    "deliberationId",
    "organizationId",
    "teamId",
    "projectId",
    "agentId",
    "participantId",
    "outcomeId",
    "status",
    "releasedAt",
  ],
  additionalProperties: false,
} as const;

export type OrganizationTeamBoundEventPayload = FromSchema<
  typeof organizationTeamBoundEventPayloadSchema
>;
export type OrganizationTeamKindChangedEventPayload = FromSchema<
  typeof organizationTeamKindChangedEventPayloadSchema
>;
export type OrganizationAgentIdentityChangedEventPayload = FromSchema<
  typeof organizationAgentIdentityChangedEventPayloadSchema
>;
export type OrganizationAgentMembershipChangedEventPayload = FromSchema<
  typeof organizationAgentMembershipChangedEventPayloadSchema
>;
export type OrganizationExternalAgentDeploymentBoundEventPayload = FromSchema<
  typeof organizationExternalAgentDeploymentBoundEventPayloadSchema
>;
export type OrganizationExternalAgentDeploymentRetiredEventPayload = FromSchema<
  typeof organizationExternalAgentDeploymentRetiredEventPayloadSchema
>;
export type OrganizationChannelMembershipChangedEventPayload = FromSchema<
  typeof organizationChannelMembershipChangedEventPayloadSchema
>;
export type OrganizationDeliberationParticipantBoundEventPayload = FromSchema<
  typeof organizationDeliberationParticipantBoundEventPayloadSchema
>;
export type OrganizationDeliberationParticipantReleasedEventPayload = FromSchema<
  typeof organizationDeliberationParticipantReleasedEventPayloadSchema
>;
