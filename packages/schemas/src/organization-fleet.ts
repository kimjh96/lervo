import type { FromSchema } from "json-schema-to-ts";

import { schemaVersionSchema, sha256Schema, timestampSchema } from "./common.js";
import { syncDestinationIdSchema } from "./hub-sync.js";
import {
  organizationIdSchema,
  organizationNodeIdSchema,
  organizationPrincipalIdSchema,
  organizationProjectTargetSchema,
} from "./organization-deployment.js";

const enrollmentIdSchema = { type: "string", pattern: "^one_[a-f0-9]{64}$" } as const;
const rolloutPlanIdSchema = { type: "string", pattern: "^orp_[a-f0-9]{64}$" } as const;
const waveObservationIdSchema = { type: "string", pattern: "^ofw_[a-f0-9]{64}$" } as const;
const rolloutApprovalIdSchema = { type: "string", pattern: "^ofa_[a-f0-9]{64}$" } as const;
const runtimeVersionSchema = {
  type: "string",
  pattern:
    "^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$",
} as const;

const nodeReadinessSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ready", "pending", "degraded", "unavailable", "stale"] },
    consecutiveObservations: { type: "integer", minimum: 0, maximum: 120 },
    sync: { type: "string", enum: ["ready", "pending", "unavailable"] },
    workstreamReplication: { type: "string", enum: ["ready", "pending", "unavailable"] },
    workspaceCoordination: {
      type: "string",
      enum: ["ready", "disabled", "pending", "unavailable"],
    },
    remoteControl: {
      type: "string",
      enum: ["ready", "disabled", "pending", "unavailable"],
    },
  },
  required: [
    "status",
    "consecutiveObservations",
    "sync",
    "workstreamReplication",
    "workspaceCoordination",
    "remoteControl",
  ],
  additionalProperties: false,
} as const;

export const organizationNodeEnrollmentSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-node-enrollment.schema.json",
  title: "Lervo organization Node enrollment",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    enrollmentId: enrollmentIdSchema,
    organizationId: organizationIdSchema,
    policyId: { type: "string", pattern: "^odp_[a-f0-9]{64}$" },
    policyHash: sha256Schema,
    target: organizationProjectTargetSchema,
    nodeId: organizationNodeIdSchema,
    destinationId: syncDestinationIdSchema,
    serviceInstanceId: { type: "string", pattern: "^nfi_[a-f0-9]{24}$" },
    runtimeVersion: runtimeVersionSchema,
    runtimeArtifactHash: sha256Schema,
    credentialId: { type: "string", pattern: "^ocg_[a-f0-9]{64}$" },
    credentialDeliveryId: { type: "string", pattern: "^ocd_[a-f0-9]{64}$" },
    localPlanId: { type: "string", pattern: "^nfp_[a-f0-9]{24}$" },
    localApplyReceiptHash: sha256Schema,
    readiness: nodeReadinessSchema,
    enrolledBy: organizationPrincipalIdSchema,
    enrolledAt: timestampSchema,
    secretMaterial: { type: "string", const: "excluded" },
  },
  required: [
    "schemaVersion",
    "enrollmentId",
    "organizationId",
    "policyId",
    "policyHash",
    "target",
    "nodeId",
    "destinationId",
    "serviceInstanceId",
    "runtimeVersion",
    "runtimeArtifactHash",
    "credentialId",
    "credentialDeliveryId",
    "localPlanId",
    "localApplyReceiptHash",
    "readiness",
    "enrolledBy",
    "enrolledAt",
    "secretMaterial",
  ],
  additionalProperties: false,
} as const;

export const organizationFleetRolloutPlanSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-fleet-rollout-plan.schema.json",
  title: "Lervo organization fleet rollout plan",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    rolloutPlanId: rolloutPlanIdSchema,
    organizationId: organizationIdSchema,
    policyId: { type: "string", pattern: "^odp_[a-f0-9]{64}$" },
    policyHash: sha256Schema,
    target: organizationProjectTargetSchema,
    targetRuntimeVersion: runtimeVersionSchema,
    targetArtifactHash: sha256Schema,
    enrollmentIds: {
      type: "array",
      minItems: 1,
      maxItems: 256,
      uniqueItems: true,
      items: enrollmentIdSchema,
    },
    waves: {
      type: "array",
      minItems: 1,
      maxItems: 256,
      items: {
        type: "object",
        properties: {
          waveNumber: { type: "integer", minimum: 1, maximum: 256 },
          enrollmentIds: {
            type: "array",
            minItems: 1,
            maxItems: 32,
            uniqueItems: true,
            items: enrollmentIdSchema,
          },
        },
        required: ["waveNumber", "enrollmentIds"],
        additionalProperties: false,
      },
    },
    healthGate: {
      type: "object",
      properties: {
        minimumConsecutiveReadyObservations: { type: "integer", const: 3 },
        maximumUnavailableNodes: { type: "integer", const: 0 },
        allowOfflineReady: { type: "boolean", const: false },
      },
      required: [
        "minimumConsecutiveReadyObservations",
        "maximumUnavailableNodes",
        "allowOfflineReady",
      ],
      additionalProperties: false,
    },
    failurePolicy: { type: "string", const: "hold_for_explicit_rollback" },
    plannedBy: organizationPrincipalIdSchema,
    plannedAt: timestampSchema,
    effect: {
      type: "object",
      properties: {
        deployment: { type: "string", const: "not_executed" },
        rollback: { type: "string", const: "not_executed" },
        approval: { type: "string", const: "not_granted" },
      },
      required: ["deployment", "rollback", "approval"],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "rolloutPlanId",
    "organizationId",
    "policyId",
    "policyHash",
    "target",
    "targetRuntimeVersion",
    "targetArtifactHash",
    "enrollmentIds",
    "waves",
    "healthGate",
    "failurePolicy",
    "plannedBy",
    "plannedAt",
    "effect",
  ],
  additionalProperties: false,
} as const;

export const organizationFleetWaveObservationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-fleet-wave-observation.schema.json",
  title: "Lervo organization fleet wave observation",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    observationId: waveObservationIdSchema,
    organizationId: organizationIdSchema,
    policyId: { type: "string", pattern: "^odp_[a-f0-9]{64}$" },
    rolloutPlanId: rolloutPlanIdSchema,
    rolloutPlanHash: sha256Schema,
    waveNumber: { type: "integer", minimum: 1, maximum: 256 },
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: {
        type: "object",
        properties: {
          enrollmentId: enrollmentIdSchema,
          nodeId: organizationNodeIdSchema,
          runtimeVersion: runtimeVersionSchema,
          runtimeArtifactHash: sha256Schema,
          readiness: nodeReadinessSchema,
        },
        required: ["enrollmentId", "nodeId", "runtimeVersion", "runtimeArtifactHash", "readiness"],
        additionalProperties: false,
      },
    },
    observedBy: organizationPrincipalIdSchema,
    observedAt: timestampSchema,
    effect: {
      type: "object",
      properties: {
        decision: { type: "string", const: "not_selected" },
        deployment: { type: "string", const: "not_executed" },
        rollback: { type: "string", const: "not_executed" },
      },
      required: ["decision", "deployment", "rollback"],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "observationId",
    "organizationId",
    "policyId",
    "rolloutPlanId",
    "rolloutPlanHash",
    "waveNumber",
    "nodes",
    "observedBy",
    "observedAt",
    "effect",
  ],
  additionalProperties: false,
} as const;

export const organizationFleetRolloutApprovalSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-fleet-rollout-approval.schema.json",
  title: "Lervo organization fleet rollout approval",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    approvalId: rolloutApprovalIdSchema,
    organizationId: organizationIdSchema,
    policyId: { type: "string", pattern: "^odp_[a-f0-9]{64}$" },
    rolloutPlanId: rolloutPlanIdSchema,
    rolloutPlanHash: sha256Schema,
    waveNumber: { type: "integer", minimum: 1, maximum: 256 },
    action: { type: "string", enum: ["execute_wave", "rollback_wave"] },
    evidenceObservationId: {
      oneOf: [{ type: "null" }, waveObservationIdSchema],
    },
    evidenceObservationHash: {
      oneOf: [{ type: "null" }, sha256Schema],
    },
    approvedBy: organizationPrincipalIdSchema,
    approvedAt: timestampSchema,
    effect: {
      type: "object",
      properties: {
        deployment: { type: "string", const: "not_executed" },
        rollback: { type: "string", const: "not_executed" },
        approval: { type: "string", const: "granted" },
      },
      required: ["deployment", "rollback", "approval"],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "approvalId",
    "organizationId",
    "policyId",
    "rolloutPlanId",
    "rolloutPlanHash",
    "waveNumber",
    "action",
    "evidenceObservationId",
    "evidenceObservationHash",
    "approvedBy",
    "approvedAt",
    "effect",
  ],
  additionalProperties: false,
} as const;

export type OrganizationNodeEnrollment = FromSchema<typeof organizationNodeEnrollmentSchema>;
export type OrganizationFleetRolloutPlan = FromSchema<typeof organizationFleetRolloutPlanSchema>;
export type OrganizationFleetWaveObservation = FromSchema<
  typeof organizationFleetWaveObservationSchema
>;
export type OrganizationFleetRolloutApproval = FromSchema<
  typeof organizationFleetRolloutApprovalSchema
>;
