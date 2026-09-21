import type { FromSchema } from "json-schema-to-ts";

import {
  conversationIdSchema,
  conversationParticipantIdSchema,
  deliberationIdSchema,
  deliberationPolicyIdSchema,
  projectIdSchema,
  roleIdSchema,
  schemaVersionSchema,
  semverSchema,
  sha256Schema,
  timestampSchema,
  workforceAgentIdSchema,
} from "./common.js";

const nullableModelSchema = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 128, pattern: "^[^\\u0000\\r\\n]+$" },
    { type: "null" },
  ],
} as const;

export const deliberationParticipantAssignmentSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/deliberation-participant-assignment.schema.json",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    participationAssignmentId: {
      type: "string",
      pattern: "^dpa_[a-f0-9]{40}$",
    },
    deliberationId: deliberationIdSchema,
    policyId: deliberationPolicyIdSchema,
    policyRoleId: roleIdSchema,
    projectId: projectIdSchema,
    conversationId: conversationIdSchema,
    organizationId: {
      type: "string",
      pattern: "^org_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
    },
    teamId: {
      type: "string",
      pattern: "^team_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
    },
    channelMembershipId: {
      type: "string",
      pattern: "^cmem_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
    },
    membershipId: {
      type: "string",
      pattern: "^amem_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
    },
    deploymentId: {
      type: "string",
      pattern: "^adep_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
    },
    agentId: workforceAgentIdSchema,
    participantId: conversationParticipantIdSchema,
    agentRoleId: roleIdSchema,
    roleVersion: semverSchema,
    roleContractHash: sha256Schema,
    roleProfileHash: sha256Schema,
    providerPolicyHash: sha256Schema,
    provider: { type: "string", enum: ["codex", "claude"] },
    model: nullableModelSchema,
    reasoningEffort: {
      anyOf: [
        { type: "string", enum: ["low", "medium", "high", "xhigh", "max"] },
        { type: "null" },
      ],
    },
    executionRouteHash: sha256Schema,
    acceptedAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "participationAssignmentId",
    "deliberationId",
    "policyId",
    "policyRoleId",
    "projectId",
    "conversationId",
    "organizationId",
    "teamId",
    "channelMembershipId",
    "membershipId",
    "deploymentId",
    "agentId",
    "participantId",
    "agentRoleId",
    "roleVersion",
    "roleContractHash",
    "roleProfileHash",
    "providerPolicyHash",
    "provider",
    "model",
    "reasoningEffort",
    "executionRouteHash",
    "acceptedAt",
  ],
  additionalProperties: false,
} as const;

export type DeliberationParticipantAssignment = FromSchema<
  typeof deliberationParticipantAssignmentSchema
>;
