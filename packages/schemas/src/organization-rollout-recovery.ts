import type { FromSchema } from "json-schema-to-ts";

import { schemaVersionSchema, sha256Schema, timestampSchema } from "./common.js";
import { syncDestinationIdSchema } from "./hub-sync.js";
import {
  organizationNodeIdSchema,
  organizationProjectTargetSchema,
} from "./organization-deployment.js";

export const organizationNodeRolloutRecoveryObservationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-node-rollout-recovery-observation.schema.json",
  title: "Lervo organization Node rollout recovery observation",
  type: "object",
  properties: {
    localPlanId: { type: "string", pattern: "^nfp_[a-f0-9]{24}$" },
    localPlanHash: sha256Schema,
    registry: { type: "string", enum: ["register", "refresh", "unchanged"] },
    serviceTarget: { type: "string", enum: ["absent", "desired", "other", "conflict"] },
    legacyTarget: { type: "string", enum: ["absent", "present_unverified", "conflict"] },
    privacy: {
      type: "object",
      properties: {
        absolutePaths: { type: "string", const: "excluded" },
        credentials: { type: "string", const: "excluded" },
        serviceDefinitionBodies: { type: "string", const: "excluded" },
      },
      required: ["absolutePaths", "credentials", "serviceDefinitionBodies"],
      additionalProperties: false,
    },
  },
  required: [
    "localPlanId",
    "localPlanHash",
    "registry",
    "serviceTarget",
    "legacyTarget",
    "privacy",
  ],
  additionalProperties: false,
} as const;

export const organizationNodeRolloutRecoveryReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/organization-node-rollout-recovery-receipt.schema.json",
  title: "Lervo organization Node rollout recovery receipt",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    recoveryReceiptId: { type: "string", pattern: "^ory_[a-f0-9]{64}$" },
    deliveryId: { type: "string", pattern: "^oxd_[a-f0-9]{64}$" },
    deliveryHash: sha256Schema,
    idempotencyKey: { type: "string", pattern: "^idk_[A-Za-z0-9][A-Za-z0-9_-]{15,63}$" },
    executionPlanId: { type: "string", pattern: "^oxp_[a-f0-9]{64}$" },
    target: organizationProjectTargetSchema,
    nodeId: organizationNodeIdSchema,
    destinationId: syncDestinationIdSchema,
    inspectedAt: timestampSchema,
    classification: { type: "string", enum: ["applied", "not_applied", "unknown"] },
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
    "executionPlanId",
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

export type OrganizationNodeRolloutRecoveryObservation = FromSchema<
  typeof organizationNodeRolloutRecoveryObservationSchema
>;
export type OrganizationNodeRolloutRecoveryReceipt = FromSchema<
  typeof organizationNodeRolloutRecoveryReceiptSchema,
  { references: [typeof organizationNodeRolloutRecoveryObservationSchema] }
>;
