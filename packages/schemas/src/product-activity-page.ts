import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";
import {
  productSurfaceCoordinateSchema,
  productSurfacePrivacyClassSchema,
  productSurfaceProjectionStatusSchema,
} from "./product-surface-common.js";

export const productActivityActionClasses = [
  "message",
  "repository_read",
  "repository_edit",
  "command",
  "verification",
  "approval",
  "handoff",
  "delivery",
  "failure",
  "lifecycle",
] as const;

export const productActivityCursorSchema = {
  type: "string",
  pattern: "^pac_[a-f0-9]{24}$",
} as const;

const activityItemSchema = {
  type: "object",
  properties: {
    activityId: { type: "string", pattern: "^pact_[a-f0-9]{24}$" },
    observedAt: timestampSchema,
    actor: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["human", "agent", "system", "provider", "adapter"] },
        coordinate: productSurfaceCoordinateSchema,
      },
      required: ["kind", "coordinate"],
      additionalProperties: false,
    },
    actionClass: { type: "string", enum: productActivityActionClasses },
    object: {
      type: "object",
      properties: {
        kind: productSurfaceCoordinateSchema,
        coordinate: productSurfaceCoordinateSchema,
      },
      required: ["kind", "coordinate"],
      additionalProperties: false,
    },
    outcome: {
      type: "string",
      enum: ["started", "succeeded", "failed", "blocked", "cancelled", "unknown"],
    },
    salience: { type: "string", enum: ["low", "normal", "high", "critical"] },
    privacyClass: productSurfacePrivacyClassSchema,
    sourceCoordinates: {
      type: "array",
      items: productSurfaceCoordinateSchema,
      minItems: 1,
      maxItems: 32,
      uniqueItems: true,
    },
    projectionStatus: productSurfaceProjectionStatusSchema,
  },
  required: [
    "activityId",
    "observedAt",
    "actor",
    "actionClass",
    "object",
    "outcome",
    "salience",
    "privacyClass",
    "sourceCoordinates",
    "projectionStatus",
  ],
  additionalProperties: false,
} as const;

export const productActivityPageSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/product-activity-page.schema.json",
  title: "Lervo product activity page",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    kind: { const: "product_surface.activity" },
    sourceEventHeadHash: sha256Schema,
    repositoryRevision: sha256Schema,
    requestCursor: { anyOf: [productActivityCursorSchema, { type: "null" }] },
    returnedCursor: productActivityCursorSchema,
    nextCursor: { anyOf: [productActivityCursorSchema, { type: "null" }] },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    status: { type: "string", enum: ["complete", "empty", "failed"] },
    failureCode: {
      anyOf: [
        {
          type: "string",
          enum: [
            "activity_evidence_invalid",
            "activity_cursor_stale",
            "activity_schema_unsupported",
          ],
        },
        { type: "null" },
      ],
    },
    items: { type: "array", items: activityItemSchema, maxItems: 100 },
  },
  required: [
    "schemaVersion",
    "kind",
    "sourceEventHeadHash",
    "repositoryRevision",
    "requestCursor",
    "returnedCursor",
    "nextCursor",
    "limit",
    "status",
    "failureCode",
    "items",
  ],
  oneOf: [
    {
      properties: {
        status: { const: "complete" },
        failureCode: { type: "null" },
        items: { type: "array", items: activityItemSchema, minItems: 1, maxItems: 100 },
      },
      required: ["status", "failureCode", "items"],
    },
    {
      properties: {
        status: { const: "empty" },
        failureCode: { type: "null" },
        items: { type: "array", maxItems: 0 },
      },
      required: ["status", "failureCode", "items"],
    },
    {
      properties: {
        status: { const: "failed" },
        failureCode: {
          type: "string",
          enum: [
            "activity_evidence_invalid",
            "activity_cursor_stale",
            "activity_schema_unsupported",
          ],
        },
        items: { type: "array", maxItems: 0 },
      },
      required: ["status", "failureCode", "items"],
    },
  ],
  additionalProperties: false,
} as const;

export type ProductActivityPageV1 = FromSchema<typeof productActivityPageSchema>;
export type ProductActivityItemV1 = ProductActivityPageV1["items"][number];
export type ProductActivityActionClass = (typeof productActivityActionClasses)[number];
