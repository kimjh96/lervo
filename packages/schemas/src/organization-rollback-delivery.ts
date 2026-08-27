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
import { organizationNodeRolloutRecoveryObservationSchema } from "./organization-rollout-recovery.js";
import {
  organizationNodeRolloutRollbackPlanSchema,
  organizationNodeRolloutRollbackReceiptSchema,
} from "./organization-rollout-rollback.js";

const idempotencyKeySchema = {
  type: "string",
  pattern: "^idk_[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
} as const;
const nonceSchema = { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" } as const;

export const organizationNodeRollbackDeliverySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-node-rollback-delivery.schema.json",
  title: "Lervo authenticated organization Node rollback delivery",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    deliveryId: { type: "string", pattern: "^obd_[a-f0-9]{64}$" },
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
    observation: { $ref: organizationFleetWaveObservationSchema.$id },
    enrollment: { $ref: organizationNodeEnrollmentSchema.$id },
    rollbackPlan: { $ref: organizationNodeRolloutRollbackPlanSchema.$id },
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
    "rollbackPlan",
    "effect",
    "secretMaterial",
  ],
  additionalProperties: false,
} as const;

export const signedOrganizationNodeRollbackDeliverySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/signed-organization-node-rollback-delivery.schema.json",
  title: "Lervo signed organization Node rollback delivery envelope",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    delivery: { $ref: organizationNodeRollbackDeliverySchema.$id },
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

export const organizationNodeRollbackDeliveryReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-node-rollback-delivery-receipt.schema.json",
  title: "Lervo organization Node rollback delivery receipt",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    deliveryReceiptId: { type: "string", pattern: "^obr_[a-f0-9]{64}$" },
    deliveryId: { type: "string", pattern: "^obd_[a-f0-9]{64}$" },
    deliveryHash: sha256Schema,
    idempotencyKey: idempotencyKeySchema,
    rollbackReceipt: { $ref: organizationNodeRolloutRollbackReceiptSchema.$id },
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
    "deliveryReceiptId",
    "deliveryId",
    "deliveryHash",
    "idempotencyKey",
    "rollbackReceipt",
    "completedAt",
    "effect",
    "secretMaterial",
  ],
  additionalProperties: false,
} as const;

export const organizationNodeRollbackRecoveryReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-node-rollback-recovery-receipt.schema.json",
  title: "Lervo organization Node rollback recovery receipt",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    recoveryReceiptId: { type: "string", pattern: "^obq_[a-f0-9]{64}$" },
    deliveryId: { type: "string", pattern: "^obd_[a-f0-9]{64}$" },
    deliveryHash: sha256Schema,
    idempotencyKey: idempotencyKeySchema,
    rollbackPlanId: { type: "string", pattern: "^orb_[a-f0-9]{64}$" },
    target: organizationProjectTargetSchema,
    nodeId: organizationNodeIdSchema,
    destinationId: syncDestinationIdSchema,
    inspectedAt: timestampSchema,
    classification: { type: "string", enum: ["rolled_back", "not_rolled_back", "unknown"] },
    baseline: { $ref: organizationNodeRolloutRecoveryObservationSchema.$id },
    current: { $ref: organizationNodeRolloutRecoveryObservationSchema.$id },
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
    "recoveryReceiptId",
    "deliveryId",
    "deliveryHash",
    "idempotencyKey",
    "rollbackPlanId",
    "target",
    "nodeId",
    "destinationId",
    "inspectedAt",
    "classification",
    "baseline",
    "current",
    "effect",
    "secretMaterial",
  ],
  additionalProperties: false,
} as const;

export type OrganizationNodeRollbackDelivery = FromSchema<
  typeof organizationNodeRollbackDeliverySchema,
  {
    references: [
      typeof signedOrganizationDeploymentPolicySchema,
      typeof organizationDeploymentPolicySchema,
      typeof organizationFleetRolloutPlanSchema,
      typeof organizationFleetRolloutApprovalSchema,
      typeof organizationFleetWaveObservationSchema,
      typeof organizationNodeEnrollmentSchema,
      typeof organizationNodeRolloutRollbackPlanSchema,
    ];
  }
>;
export type SignedOrganizationNodeRollbackDelivery = FromSchema<
  typeof signedOrganizationNodeRollbackDeliverySchema,
  {
    references: [
      typeof organizationNodeRollbackDeliverySchema,
      typeof signedOrganizationDeploymentPolicySchema,
      typeof organizationDeploymentPolicySchema,
      typeof organizationFleetRolloutPlanSchema,
      typeof organizationFleetRolloutApprovalSchema,
      typeof organizationFleetWaveObservationSchema,
      typeof organizationNodeEnrollmentSchema,
      typeof organizationNodeRolloutRollbackPlanSchema,
    ];
  }
>;
export type OrganizationNodeRollbackDeliveryReceipt = FromSchema<
  typeof organizationNodeRollbackDeliveryReceiptSchema,
  { references: [typeof organizationNodeRolloutRollbackReceiptSchema] }
>;
export type OrganizationNodeRollbackRecoveryReceipt = FromSchema<
  typeof organizationNodeRollbackRecoveryReceiptSchema,
  { references: [typeof organizationNodeRolloutRecoveryObservationSchema] }
>;
