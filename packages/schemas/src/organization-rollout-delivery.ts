import type { FromSchema } from "json-schema-to-ts";

import { schemaVersionSchema, sha256Schema, timestampSchema } from "./common.js";
import { syncDestinationIdSchema } from "./hub-sync.js";
import {
  organizationDeploymentPolicySchema,
  organizationNodeIdSchema,
  organizationProjectTargetSchema,
  signedOrganizationDeploymentPolicySchema,
} from "./organization-deployment.js";
import {
  organizationFleetRolloutApprovalSchema,
  organizationFleetRolloutPlanSchema,
  organizationFleetWaveObservationSchema,
  organizationNodeEnrollmentSchema,
} from "./organization-fleet.js";
import {
  organizationNodeRolloutExecutionPlanSchema,
  organizationNodeRolloutExecutionReceiptSchema,
} from "./organization-rollout-execution.js";

const idempotencyKeySchema = {
  type: "string",
  pattern: "^idk_[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
} as const;

const nonceSchema = { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" } as const;

export const organizationNodeRolloutDeliverySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-node-rollout-delivery.schema.json",
  title: "Lervo authenticated organization Node rollout delivery",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    deliveryId: { type: "string", pattern: "^oxd_[a-f0-9]{64}$" },
    idempotencyKey: idempotencyKeySchema,
    nonce: nonceSchema,
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    target: organizationProjectTargetSchema,
    nodeId: organizationNodeIdSchema,
    destinationId: syncDestinationIdSchema,
    signedPolicy: { $ref: signedOrganizationDeploymentPolicySchema.$id },
    rolloutPlan: { $ref: organizationFleetRolloutPlanSchema.$id },
    approval: { $ref: organizationFleetRolloutApprovalSchema.$id },
    observation: {
      oneOf: [{ type: "null" }, { $ref: organizationFleetWaveObservationSchema.$id }],
    },
    enrollment: { $ref: organizationNodeEnrollmentSchema.$id },
    executionPlan: { $ref: organizationNodeRolloutExecutionPlanSchema.$id },
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
    "deliveryId",
    "idempotencyKey",
    "nonce",
    "issuedAt",
    "expiresAt",
    "target",
    "nodeId",
    "destinationId",
    "signedPolicy",
    "rolloutPlan",
    "approval",
    "observation",
    "enrollment",
    "executionPlan",
    "effect",
    "secretMaterial",
  ],
  additionalProperties: false,
} as const;

export const signedOrganizationNodeRolloutDeliverySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/signed-organization-node-rollout-delivery.schema.json",
  title: "Lervo signed organization Node rollout delivery envelope",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    delivery: { $ref: organizationNodeRolloutDeliverySchema.$id },
    signature: {
      type: "object",
      properties: {
        algorithm: { type: "string", const: "ed25519" },
        keyId: { type: "string", pattern: "^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$" },
        value: { type: "string", pattern: "^[A-Za-z0-9_-]{86}$" },
      },
      required: ["algorithm", "keyId", "value"],
      additionalProperties: false,
    },
  },
  required: ["schemaVersion", "delivery", "signature"],
  additionalProperties: false,
} as const;

export const organizationNodeRolloutDeliveryReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-node-rollout-delivery-receipt.schema.json",
  title: "Lervo organization Node rollout delivery receipt",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    deliveryReceiptId: { type: "string", pattern: "^odr_[a-f0-9]{64}$" },
    deliveryId: { type: "string", pattern: "^oxd_[a-f0-9]{64}$" },
    deliveryHash: sha256Schema,
    idempotencyKey: idempotencyKeySchema,
    executionReceipt: { $ref: organizationNodeRolloutExecutionReceiptSchema.$id },
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
    "deliveryReceiptId",
    "deliveryId",
    "deliveryHash",
    "idempotencyKey",
    "executionReceipt",
    "completedAt",
    "effect",
    "secretMaterial",
  ],
  additionalProperties: false,
} as const;

export type OrganizationNodeRolloutDelivery = FromSchema<
  typeof organizationNodeRolloutDeliverySchema,
  {
    references: [
      typeof signedOrganizationDeploymentPolicySchema,
      typeof organizationDeploymentPolicySchema,
      typeof organizationFleetRolloutPlanSchema,
      typeof organizationFleetRolloutApprovalSchema,
      typeof organizationFleetWaveObservationSchema,
      typeof organizationNodeEnrollmentSchema,
      typeof organizationNodeRolloutExecutionPlanSchema,
    ];
  }
>;
export type SignedOrganizationNodeRolloutDelivery = FromSchema<
  typeof signedOrganizationNodeRolloutDeliverySchema,
  {
    references: [
      typeof organizationNodeRolloutDeliverySchema,
      typeof signedOrganizationDeploymentPolicySchema,
      typeof organizationDeploymentPolicySchema,
      typeof organizationFleetRolloutPlanSchema,
      typeof organizationFleetRolloutApprovalSchema,
      typeof organizationFleetWaveObservationSchema,
      typeof organizationNodeEnrollmentSchema,
      typeof organizationNodeRolloutExecutionPlanSchema,
    ];
  }
>;
export type OrganizationNodeRolloutDeliveryReceipt = FromSchema<
  typeof organizationNodeRolloutDeliveryReceiptSchema,
  { references: [typeof organizationNodeRolloutExecutionReceiptSchema] }
>;
