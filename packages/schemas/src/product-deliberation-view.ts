import type { FromSchema } from "json-schema-to-ts";

import {
  conversationEventIdSchema,
  conversationIdSchema,
  conversationParticipantIdSchema,
  conversationThreadIdSchema,
  deliberationArtifactIdSchema,
  deliberationClaimIdSchema,
  deliberationIdSchema,
  deliberationObjectionIdSchema,
  deliberationPolicyIdSchema,
  projectIdSchema,
  providerSchema,
  roleIdSchema,
  runIdSchema,
  semverSchema,
  sessionIdSchema,
  sha256Schema,
  verificationIdSchema,
  verificationSuiteIdSchema,
  workforceAgentIdSchema,
} from "./common.js";
import { deliberationArtifactKinds } from "./deliberation-artifact.js";
import { deliberationResponsibilities } from "./deliberation-policy.js";
import {
  productSurfaceCoordinateSchema,
  productSurfaceProjectionStatusSchema,
  productSurfaceReasonCodeSchema,
} from "./product-surface-common.js";

const nullableParticipantIdSchema = {
  anyOf: [conversationParticipantIdSchema, { type: "null" }],
} as const;
const nullableConversationEventIdSchema = {
  anyOf: [conversationEventIdSchema, { type: "null" }],
} as const;
const nullableConversationIdSchema = { anyOf: [conversationIdSchema, { type: "null" }] } as const;
const nullableSha256Schema = { anyOf: [sha256Schema, { type: "null" }] } as const;
const nullableAgentIdSchema = { anyOf: [workforceAgentIdSchema, { type: "null" }] } as const;
const nullableRoleVersionSchema = { anyOf: [semverSchema, { type: "null" }] } as const;

const participantBindingSchema = {
  type: "object",
  properties: {
    roleId: roleIdSchema,
    responsibility: { type: "string", enum: deliberationResponsibilities },
    providerPolicyHash: sha256Schema,
    disposition: { type: "string", enum: ["hired_agent", "policy_only"] },
    participantId: nullableParticipantIdSchema,
    agentId: nullableAgentIdSchema,
    roleVersion: nullableRoleVersionSchema,
  },
  required: [
    "roleId",
    "responsibility",
    "providerPolicyHash",
    "disposition",
    "participantId",
    "agentId",
    "roleVersion",
  ],
  oneOf: [
    {
      properties: {
        disposition: { const: "hired_agent" },
        participantId: conversationParticipantIdSchema,
        agentId: workforceAgentIdSchema,
        roleVersion: semverSchema,
      },
      required: ["disposition", "participantId", "agentId", "roleVersion"],
    },
    {
      properties: {
        disposition: { const: "policy_only" },
        participantId: { type: "null" },
        agentId: { type: "null" },
        roleVersion: { type: "null" },
      },
      required: ["disposition", "participantId", "agentId", "roleVersion"],
    },
  ],
  additionalProperties: false,
} as const;

const artifactSummarySchema = {
  type: "object",
  properties: {
    artifactId: deliberationArtifactIdSchema,
    kind: { type: "string", enum: deliberationArtifactKinds },
    round: { type: "integer", minimum: 1, maximum: 20 },
    producerRoleId: roleIdSchema,
    provider: providerSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    contentHash: sha256Schema,
    previousArtifactIds: {
      type: "array",
      items: deliberationArtifactIdSchema,
      maxItems: 100,
      uniqueItems: true,
    },
    writingPermitStatus: { type: "string", enum: ["valid", "missing", "invalid"] },
    claimIds: {
      type: "array",
      items: deliberationClaimIdSchema,
      maxItems: 100,
      uniqueItems: true,
    },
    objectionIds: {
      type: "array",
      items: deliberationObjectionIdSchema,
      maxItems: 100,
      uniqueItems: true,
    },
    verificationIds: {
      type: "array",
      items: verificationIdSchema,
      maxItems: 32,
      uniqueItems: true,
    },
    decisionCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
  },
  required: [
    "artifactId",
    "kind",
    "round",
    "producerRoleId",
    "provider",
    "runId",
    "sessionId",
    "contentHash",
    "previousArtifactIds",
    "writingPermitStatus",
    "claimIds",
    "objectionIds",
    "verificationIds",
    "decisionCoordinate",
  ],
  additionalProperties: false,
} as const;

const verificationEntrySchema = {
  type: "object",
  properties: {
    verificationId: verificationIdSchema,
    suiteId: verificationSuiteIdSchema,
    artifactId: deliberationArtifactIdSchema,
    status: { type: "string", enum: ["passed", "failed", "cancelled", "unavailable"] },
    resultHash: { anyOf: [sha256Schema, { type: "null" }] },
  },
  required: ["verificationId", "suiteId", "artifactId", "status", "resultHash"],
  additionalProperties: false,
} as const;

const unresolvedObjectionSchema = {
  type: "object",
  properties: {
    objectionId: deliberationObjectionIdSchema,
    artifactId: deliberationArtifactIdSchema,
    blocking: { const: true },
    status: { const: "open" },
  },
  required: ["objectionId", "artifactId", "blocking", "status"],
  additionalProperties: false,
} as const;

export const productDeliberationViewSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/product-deliberation-view.schema.json",
  title: "Lervo product deliberation view",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    kind: { const: "product_surface.deliberation" },
    deliberationId: deliberationIdSchema,
    projectId: projectIdSchema,
    policyId: deliberationPolicyIdSchema,
    policyHash: sha256Schema,
    sourceEventId: nullableConversationEventIdSchema,
    conversationId: nullableConversationIdSchema,
    threadId: { anyOf: [conversationThreadIdSchema, { type: "null" }] },
    requesterParticipantId: nullableParticipantIdSchema,
    originBindingDigest: nullableSha256Schema,
    sourceEventHeadHash: sha256Schema,
    repositoryRevision: sha256Schema,
    status: {
      type: "string",
      enum: ["running", "unknown", "interrupted", "converged", "no_consensus", "failed"],
    },
    round: { type: "integer", minimum: 0, maximum: 20 },
    maximumRounds: { type: "integer", minimum: 1, maximum: 20 },
    nextAction: { type: "string", enum: ["wait", "resume", "none"] },
    terminalReason: { anyOf: [productSurfaceReasonCodeSchema, { type: "null" }] },
    participants: {
      type: "array",
      items: participantBindingSchema,
      minItems: 2,
      maxItems: 16,
    },
    artifacts: { type: "array", items: artifactSummarySchema, maxItems: 500 },
    verifications: { type: "array", items: verificationEntrySchema, maxItems: 32 },
    unresolvedObjections: {
      type: "array",
      items: unresolvedObjectionSchema,
      maxItems: 100,
    },
    resourceReportCoordinate: {
      anyOf: [productSurfaceCoordinateSchema, { type: "null" }],
    },
    publicationCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
    originDeliveryCoordinate: {
      anyOf: [productSurfaceCoordinateSchema, { type: "null" }],
    },
    projectionStatus: productSurfaceProjectionStatusSchema,
    projectionReasonCode: {
      anyOf: [productSurfaceReasonCodeSchema, { type: "null" }],
    },
    projectionDigest: sha256Schema,
  },
  required: [
    "schemaVersion",
    "kind",
    "deliberationId",
    "projectId",
    "policyId",
    "policyHash",
    "sourceEventId",
    "conversationId",
    "threadId",
    "requesterParticipantId",
    "originBindingDigest",
    "sourceEventHeadHash",
    "repositoryRevision",
    "status",
    "round",
    "maximumRounds",
    "nextAction",
    "terminalReason",
    "participants",
    "artifacts",
    "verifications",
    "unresolvedObjections",
    "resourceReportCoordinate",
    "publicationCoordinate",
    "originDeliveryCoordinate",
    "projectionStatus",
    "projectionReasonCode",
    "projectionDigest",
  ],
  oneOf: [
    {
      properties: {
        projectionStatus: { const: "complete" },
        projectionReasonCode: { type: "null" },
      },
      required: ["projectionStatus", "projectionReasonCode"],
    },
    {
      properties: {
        projectionStatus: { enum: ["partial", "unavailable", "invalid"] },
        projectionReasonCode: productSurfaceReasonCodeSchema,
      },
      required: ["projectionStatus", "projectionReasonCode"],
    },
  ],
  additionalProperties: false,
} as const;

export type ProductDeliberationViewV1 = FromSchema<typeof productDeliberationViewSchema>;
