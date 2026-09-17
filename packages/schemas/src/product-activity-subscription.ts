import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";
import { productActivityCursorSchema } from "./product-activity-page.js";
import {
  productSurfaceCoordinateSchema,
  productSurfaceReasonCodeSchema,
} from "./product-surface-common.js";

const subscriptionIdSchema = {
  type: "string",
  pattern: "^pas_[a-f0-9]{24}$",
} as const;

export const productActivitySubscriptionRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/product-activity-subscription-request.schema.json",
  title: "Lervo product activity subscription request",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    kind: { const: "product_surface.activity_subscription_request" },
    subscriptionId: subscriptionIdSchema,
    originCoordinate: productSurfaceCoordinateSchema,
    authorizationDigest: sha256Schema,
    resumeCursor: { anyOf: [productActivityCursorSchema, { type: "null" }] },
    maximumPageSize: { type: "integer", minimum: 1, maximum: 100 },
    requestDigest: sha256Schema,
  },
  required: [
    "schemaVersion",
    "kind",
    "subscriptionId",
    "originCoordinate",
    "authorizationDigest",
    "resumeCursor",
    "maximumPageSize",
    "requestDigest",
  ],
  additionalProperties: false,
} as const;

export const productActivitySubscriptionHintSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/product-activity-subscription-hint.schema.json",
  title: "Lervo product activity subscription hint",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    kind: { const: "product_surface.activity_subscription_hint" },
    subscriptionId: subscriptionIdSchema,
    sequence: { type: "integer", minimum: 1 },
    observedAt: timestampSchema,
    previousCursor: { anyOf: [productActivityCursorSchema, { type: "null" }] },
    currentCursor: { anyOf: [productActivityCursorSchema, { type: "null" }] },
    sourceEventHeadHash: sha256Schema,
    repositoryRevision: sha256Schema,
    status: { type: "string", enum: ["changed", "heartbeat", "resync_required", "closed"] },
    reasonCode: { anyOf: [productSurfaceReasonCodeSchema, { type: "null" }] },
    hintDigest: sha256Schema,
  },
  required: [
    "schemaVersion",
    "kind",
    "subscriptionId",
    "sequence",
    "observedAt",
    "previousCursor",
    "currentCursor",
    "sourceEventHeadHash",
    "repositoryRevision",
    "status",
    "reasonCode",
    "hintDigest",
  ],
  oneOf: [
    {
      properties: {
        status: { const: "changed" },
        currentCursor: productActivityCursorSchema,
        reasonCode: { type: "null" },
      },
      required: ["status", "currentCursor", "reasonCode"],
    },
    {
      properties: {
        status: { const: "heartbeat" },
        reasonCode: { type: "null" },
      },
      required: ["status", "reasonCode"],
    },
    {
      properties: {
        status: { const: "resync_required" },
        currentCursor: { type: "null" },
        reasonCode: productSurfaceReasonCodeSchema,
      },
      required: ["status", "currentCursor", "reasonCode"],
    },
    {
      properties: {
        status: { const: "closed" },
        reasonCode: productSurfaceReasonCodeSchema,
      },
      required: ["status", "reasonCode"],
    },
  ],
  additionalProperties: false,
} as const;

export type ProductActivitySubscriptionRequestV1 = FromSchema<
  typeof productActivitySubscriptionRequestSchema
>;
export type ProductActivitySubscriptionHintV1 = FromSchema<
  typeof productActivitySubscriptionHintSchema
>;
