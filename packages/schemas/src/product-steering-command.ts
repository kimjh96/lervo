import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";
import {
  productSurfaceCoordinateSchema,
  productSurfaceReasonCodeSchema,
} from "./product-surface-common.js";

export const productSteeringActions = [
  "amend",
  "pause",
  "resume",
  "cancel",
  "approve",
  "retry",
  "reassign",
  "handoff",
] as const;

const steeringCommandIdSchema = {
  type: "string",
  pattern: "^psc_[a-f0-9]{24}$",
} as const;

const steeringTargetSchema = {
  type: "object",
  properties: {
    ownerDomain: {
      type: "string",
      enum: ["objective", "assignment", "execution", "policy", "attempt", "source_lifecycle"],
    },
    domainCommandId: productSurfaceCoordinateSchema,
    targetCoordinate: productSurfaceCoordinateSchema,
    expectedTargetRevision: {
      anyOf: [productSurfaceCoordinateSchema, { type: "null" }],
    },
  },
  required: ["ownerDomain", "domainCommandId", "targetCoordinate", "expectedTargetRevision"],
  additionalProperties: false,
} as const;

export const productSteeringCommandSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/product-steering-command.schema.json",
  title: "Lervo product surface steering command",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    kind: { const: "product_surface.steering_command" },
    commandId: steeringCommandIdSchema,
    action: { type: "string", enum: productSteeringActions },
    target: steeringTargetSchema,
    principalCoordinate: productSurfaceCoordinateSchema,
    originBindingDigest: sha256Schema,
    commandInputHash: sha256Schema,
    idempotencyDigest: sha256Schema,
    authority: {
      type: "object",
      properties: {
        authorityCoordinate: productSurfaceCoordinateSchema,
        planCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
        approvalCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
        leaseCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
      },
      required: ["authorityCoordinate", "planCoordinate", "approvalCoordinate", "leaseCoordinate"],
      additionalProperties: false,
    },
    requestedAt: timestampSchema,
    commandDigest: sha256Schema,
  },
  required: [
    "schemaVersion",
    "kind",
    "commandId",
    "action",
    "target",
    "principalCoordinate",
    "originBindingDigest",
    "commandInputHash",
    "idempotencyDigest",
    "authority",
    "requestedAt",
    "commandDigest",
  ],
  allOf: [
    {
      if: { properties: { action: { const: "amend" } }, required: ["action"] },
      then: {
        properties: {
          target: {
            type: "object",
            properties: { ownerDomain: { enum: ["objective", "assignment"] } },
            required: ["ownerDomain"],
          },
        },
      },
    },
    {
      if: {
        properties: { action: { enum: ["pause", "resume", "cancel"] } },
        required: ["action"],
      },
      then: {
        properties: {
          target: {
            type: "object",
            properties: { ownerDomain: { const: "execution" } },
            required: ["ownerDomain"],
          },
        },
      },
    },
    {
      if: { properties: { action: { const: "approve" } }, required: ["action"] },
      then: {
        properties: {
          target: {
            type: "object",
            properties: { ownerDomain: { const: "policy" } },
            required: ["ownerDomain"],
          },
          authority: {
            type: "object",
            properties: { approvalCoordinate: productSurfaceCoordinateSchema },
            required: ["approvalCoordinate"],
          },
        },
      },
    },
    {
      if: { properties: { action: { const: "retry" } }, required: ["action"] },
      then: {
        properties: {
          target: {
            type: "object",
            properties: { ownerDomain: { const: "attempt" } },
            required: ["ownerDomain"],
          },
        },
      },
    },
    {
      if: { properties: { action: { const: "reassign" } }, required: ["action"] },
      then: {
        properties: {
          target: {
            type: "object",
            properties: { ownerDomain: { const: "assignment" } },
            required: ["ownerDomain"],
          },
        },
      },
    },
    {
      if: { properties: { action: { const: "handoff" } }, required: ["action"] },
      then: {
        properties: {
          target: {
            type: "object",
            properties: { ownerDomain: { const: "source_lifecycle" } },
            required: ["ownerDomain"],
          },
          authority: {
            type: "object",
            properties: { planCoordinate: productSurfaceCoordinateSchema },
            required: ["planCoordinate"],
          },
        },
      },
    },
  ],
  additionalProperties: false,
} as const;

export const productSteeringResultSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/product-steering-result.schema.json",
  title: "Lervo product surface steering result",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    kind: { const: "product_surface.steering_result" },
    commandId: steeringCommandIdSchema,
    commandDigest: sha256Schema,
    sourceEventHeadHash: sha256Schema,
    repositoryRevision: sha256Schema,
    status: {
      type: "string",
      enum: ["applied", "no_effect", "blocked", "rejected", "uncertain"],
    },
    reasonCode: { anyOf: [productSurfaceReasonCodeSchema, { type: "null" }] },
    domainReceiptCoordinate: {
      anyOf: [productSurfaceCoordinateSchema, { type: "null" }],
    },
    resultDigest: sha256Schema,
  },
  required: [
    "schemaVersion",
    "kind",
    "commandId",
    "commandDigest",
    "sourceEventHeadHash",
    "repositoryRevision",
    "status",
    "reasonCode",
    "domainReceiptCoordinate",
    "resultDigest",
  ],
  oneOf: [
    {
      properties: {
        status: { const: "applied" },
        reasonCode: { type: "null" },
        domainReceiptCoordinate: productSurfaceCoordinateSchema,
      },
      required: ["status", "reasonCode", "domainReceiptCoordinate"],
    },
    {
      properties: {
        status: { const: "no_effect" },
        reasonCode: productSurfaceReasonCodeSchema,
      },
      required: ["status", "reasonCode"],
    },
    {
      properties: {
        status: { enum: ["blocked", "rejected", "uncertain"] },
        reasonCode: productSurfaceReasonCodeSchema,
        domainReceiptCoordinate: { type: "null" },
      },
      required: ["status", "reasonCode", "domainReceiptCoordinate"],
    },
  ],
  additionalProperties: false,
} as const;

export type ProductSteeringAction = (typeof productSteeringActions)[number];
export type ProductSteeringCommandV1 = FromSchema<typeof productSteeringCommandSchema>;
export type ProductSteeringResultV1 = FromSchema<typeof productSteeringResultSchema>;
