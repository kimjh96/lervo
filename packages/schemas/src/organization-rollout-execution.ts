import type { FromSchema } from "json-schema-to-ts";

import { projectIdSchema, schemaVersionSchema, sha256Schema, timestampSchema } from "./common.js";
import { syncDestinationIdSchema } from "./hub-sync.js";
import {
  organizationIdSchema,
  organizationNodeIdSchema,
  organizationPrincipalIdSchema,
  organizationProjectTargetSchema,
} from "./organization-deployment.js";

const executionPlanIdSchema = { type: "string", pattern: "^oxp_[a-f0-9]{64}$" } as const;
const rolloutPlanIdSchema = { type: "string", pattern: "^orp_[a-f0-9]{64}$" } as const;
const rolloutApprovalIdSchema = { type: "string", pattern: "^ofa_[a-f0-9]{64}$" } as const;
const enrollmentIdSchema = { type: "string", pattern: "^one_[a-f0-9]{64}$" } as const;
const runtimeVersionSchema = {
  type: "string",
  pattern:
    "^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$",
} as const;

export const organizationNodeRolloutExecutionPlanSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-node-rollout-execution-plan.schema.json",
  title: "Lervo organization Node rollout execution plan",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    executionPlanId: executionPlanIdSchema,
    organizationId: organizationIdSchema,
    policyId: { type: "string", pattern: "^odp_[a-f0-9]{64}$" },
    rolloutPlanId: rolloutPlanIdSchema,
    rolloutPlanHash: sha256Schema,
    approvalId: rolloutApprovalIdSchema,
    approvalHash: sha256Schema,
    waveNumber: { type: "integer", minimum: 1, maximum: 256 },
    action: { type: "string", const: "execute_wave" },
    target: organizationProjectTargetSchema,
    enrollmentId: enrollmentIdSchema,
    nodeId: organizationNodeIdSchema,
    destinationId: syncDestinationIdSchema,
    targetRuntimeVersion: runtimeVersionSchema,
    targetArtifactHash: sha256Schema,
    localPlanId: { type: "string", pattern: "^nfp_[a-f0-9]{24}$" },
    localPlanHash: sha256Schema,
    executedBy: organizationPrincipalIdSchema,
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
    "executionPlanId",
    "organizationId",
    "policyId",
    "rolloutPlanId",
    "rolloutPlanHash",
    "approvalId",
    "approvalHash",
    "waveNumber",
    "action",
    "target",
    "enrollmentId",
    "nodeId",
    "destinationId",
    "targetRuntimeVersion",
    "targetArtifactHash",
    "localPlanId",
    "localPlanHash",
    "executedBy",
    "plannedAt",
    "effect",
    "secretMaterial",
  ],
  additionalProperties: false,
} as const;

export const organizationNodeRolloutExecutionReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-node-rollout-execution-receipt.schema.json",
  title: "Lervo organization Node rollout execution receipt",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    executionReceiptId: { type: "string", pattern: "^oxr_[a-f0-9]{64}$" },
    executionPlanId: executionPlanIdSchema,
    executionPlanHash: sha256Schema,
    organizationId: organizationIdSchema,
    policyId: { type: "string", pattern: "^odp_[a-f0-9]{64}$" },
    rolloutPlanId: rolloutPlanIdSchema,
    approvalId: rolloutApprovalIdSchema,
    waveNumber: { type: "integer", minimum: 1, maximum: 256 },
    action: { type: "string", const: "execute_wave" },
    projectId: projectIdSchema,
    enrollmentId: enrollmentIdSchema,
    nodeId: organizationNodeIdSchema,
    destinationId: syncDestinationIdSchema,
    targetRuntimeVersion: runtimeVersionSchema,
    targetArtifactHash: sha256Schema,
    localPlanId: { type: "string", pattern: "^nfp_[a-f0-9]{24}$" },
    localPlanHash: sha256Schema,
    localApplyReceiptHash: sha256Schema,
    executedBy: organizationPrincipalIdSchema,
    completedAt: timestampSchema,
    effect: {
      type: "object",
      properties: {
        deployment: { type: "string", const: "executed" },
        rollback: { type: "string", const: "not_executed" },
      },
      required: ["deployment", "rollback"],
      additionalProperties: false,
    },
    secretMaterial: { type: "string", const: "excluded" },
  },
  required: [
    "schemaVersion",
    "executionReceiptId",
    "executionPlanId",
    "executionPlanHash",
    "organizationId",
    "policyId",
    "rolloutPlanId",
    "approvalId",
    "waveNumber",
    "action",
    "projectId",
    "enrollmentId",
    "nodeId",
    "destinationId",
    "targetRuntimeVersion",
    "targetArtifactHash",
    "localPlanId",
    "localPlanHash",
    "localApplyReceiptHash",
    "executedBy",
    "completedAt",
    "effect",
    "secretMaterial",
  ],
  additionalProperties: false,
} as const;

export type OrganizationNodeRolloutExecutionPlan = FromSchema<
  typeof organizationNodeRolloutExecutionPlanSchema
>;
export type OrganizationNodeRolloutExecutionReceipt = FromSchema<
  typeof organizationNodeRolloutExecutionReceiptSchema
>;
