import type { FromSchema } from "json-schema-to-ts";

import { projectIdSchema, schemaVersionSchema, sha256Schema, timestampSchema } from "./common.js";
import { syncDestinationIdSchema } from "./hub-sync.js";
import {
  organizationIdSchema,
  organizationNodeIdSchema,
  organizationPrincipalIdSchema,
  organizationProjectTargetSchema,
} from "./organization-deployment.js";

const rollbackPlanIdSchema = { type: "string", pattern: "^orb_[a-f0-9]{64}$" } as const;
const rolloutPlanIdSchema = { type: "string", pattern: "^orp_[a-f0-9]{64}$" } as const;
const rolloutApprovalIdSchema = { type: "string", pattern: "^ofa_[a-f0-9]{64}$" } as const;
const enrollmentIdSchema = { type: "string", pattern: "^one_[a-f0-9]{64}$" } as const;
const waveObservationIdSchema = { type: "string", pattern: "^ofw_[a-f0-9]{64}$" } as const;
const runtimeVersionSchema = {
  type: "string",
  pattern:
    "^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$",
} as const;

export const organizationNodeRolloutRollbackPlanSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-node-rollout-rollback-plan.schema.json",
  title: "Lervo organization Node rollout rollback plan",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    rollbackPlanId: rollbackPlanIdSchema,
    organizationId: organizationIdSchema,
    policyId: { type: "string", pattern: "^odp_[a-f0-9]{64}$" },
    rolloutPlanId: rolloutPlanIdSchema,
    rolloutPlanHash: sha256Schema,
    approvalId: rolloutApprovalIdSchema,
    approvalHash: sha256Schema,
    evidenceObservationId: waveObservationIdSchema,
    evidenceObservationHash: sha256Schema,
    waveNumber: { type: "integer", minimum: 1, maximum: 256 },
    action: { type: "string", const: "rollback_wave" },
    target: organizationProjectTargetSchema,
    enrollmentId: enrollmentIdSchema,
    nodeId: organizationNodeIdSchema,
    destinationId: syncDestinationIdSchema,
    failedRuntimeVersion: runtimeVersionSchema,
    failedArtifactHash: sha256Schema,
    predecessorRuntimeVersion: runtimeVersionSchema,
    predecessorArtifactHash: sha256Schema,
    localPlanId: { type: "string", pattern: "^nfp_[a-f0-9]{24}$" },
    localPlanHash: sha256Schema,
    rolledBackBy: organizationPrincipalIdSchema,
    plannedAt: timestampSchema,
    effect: {
      type: "object",
      properties: {
        deployment: { type: "string", const: "not_executed" },
        rollback: { type: "string", const: "not_executed" },
      },
      required: ["deployment", "rollback"],
      additionalProperties: false,
    },
    secretMaterial: { type: "string", const: "excluded" },
  },
  required: [
    "schemaVersion",
    "rollbackPlanId",
    "organizationId",
    "policyId",
    "rolloutPlanId",
    "rolloutPlanHash",
    "approvalId",
    "approvalHash",
    "evidenceObservationId",
    "evidenceObservationHash",
    "waveNumber",
    "action",
    "target",
    "enrollmentId",
    "nodeId",
    "destinationId",
    "failedRuntimeVersion",
    "failedArtifactHash",
    "predecessorRuntimeVersion",
    "predecessorArtifactHash",
    "localPlanId",
    "localPlanHash",
    "rolledBackBy",
    "plannedAt",
    "effect",
    "secretMaterial",
  ],
  additionalProperties: false,
} as const;

export const organizationNodeRolloutRollbackReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-node-rollout-rollback-receipt.schema.json",
  title: "Lervo organization Node rollout rollback receipt",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    rollbackReceiptId: { type: "string", pattern: "^orr_[a-f0-9]{64}$" },
    rollbackPlanId: rollbackPlanIdSchema,
    rollbackPlanHash: sha256Schema,
    organizationId: organizationIdSchema,
    policyId: { type: "string", pattern: "^odp_[a-f0-9]{64}$" },
    rolloutPlanId: rolloutPlanIdSchema,
    approvalId: rolloutApprovalIdSchema,
    evidenceObservationId: waveObservationIdSchema,
    waveNumber: { type: "integer", minimum: 1, maximum: 256 },
    action: { type: "string", const: "rollback_wave" },
    projectId: projectIdSchema,
    enrollmentId: enrollmentIdSchema,
    nodeId: organizationNodeIdSchema,
    destinationId: syncDestinationIdSchema,
    failedRuntimeVersion: runtimeVersionSchema,
    failedArtifactHash: sha256Schema,
    predecessorRuntimeVersion: runtimeVersionSchema,
    predecessorArtifactHash: sha256Schema,
    localPlanId: { type: "string", pattern: "^nfp_[a-f0-9]{24}$" },
    localPlanHash: sha256Schema,
    localApplyReceiptHash: sha256Schema,
    rolledBackBy: organizationPrincipalIdSchema,
    completedAt: timestampSchema,
    effect: {
      type: "object",
      properties: {
        deployment: { type: "string", const: "not_executed" },
        rollback: { type: "string", const: "executed" },
      },
      required: ["deployment", "rollback"],
      additionalProperties: false,
    },
    secretMaterial: { type: "string", const: "excluded" },
  },
  required: [
    "schemaVersion",
    "rollbackReceiptId",
    "rollbackPlanId",
    "rollbackPlanHash",
    "organizationId",
    "policyId",
    "rolloutPlanId",
    "approvalId",
    "evidenceObservationId",
    "waveNumber",
    "action",
    "projectId",
    "enrollmentId",
    "nodeId",
    "destinationId",
    "failedRuntimeVersion",
    "failedArtifactHash",
    "predecessorRuntimeVersion",
    "predecessorArtifactHash",
    "localPlanId",
    "localPlanHash",
    "localApplyReceiptHash",
    "rolledBackBy",
    "completedAt",
    "effect",
    "secretMaterial",
  ],
  additionalProperties: false,
} as const;

export type OrganizationNodeRolloutRollbackPlan = FromSchema<
  typeof organizationNodeRolloutRollbackPlanSchema
>;
export type OrganizationNodeRolloutRollbackReceipt = FromSchema<
  typeof organizationNodeRolloutRollbackReceiptSchema
>;
