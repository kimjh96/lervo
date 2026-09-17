import type { FromSchema } from "json-schema-to-ts";

import { adapterIdSchema } from "./adapter-primitives.js";
import { sha256Schema } from "./common.js";
import {
  productSurfaceCoordinateSchema,
  productSurfacePrivacyClassSchema,
  productSurfaceReasonCodeSchema,
  productSurfaceSectionStateSchema,
} from "./product-surface-common.js";

export const productSearchCorpusClasses = [
  "repository_knowledge",
  "repository_code",
  "conversation",
  "artifact",
  "canvas",
  "deliberation",
  "approval",
  "verification",
  "work_event",
] as const;

const corpusClassSchema = { type: "string", enum: productSearchCorpusClasses } as const;

const searchHitSchema = {
  type: "object",
  properties: {
    corpusClass: corpusClassSchema,
    sourceCoordinate: productSurfaceCoordinateSchema,
    sourceRevision: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
    contentHash: { anyOf: [sha256Schema, { type: "null" }] },
    privacyClass: productSurfacePrivacyClassSchema,
    label: { type: "string", minLength: 1, maxLength: 200 },
    rank: { type: "integer", minimum: 1, maximum: 100 },
    adapterId: adapterIdSchema,
    adapterBuildId: productSurfaceCoordinateSchema,
    matchEvidenceKind: {
      type: "string",
      enum: ["exact", "lexical", "semantic", "relation", "metadata"],
    },
  },
  required: [
    "corpusClass",
    "sourceCoordinate",
    "sourceRevision",
    "contentHash",
    "privacyClass",
    "label",
    "rank",
    "adapterId",
    "adapterBuildId",
    "matchEvidenceKind",
  ],
  anyOf: [
    {
      properties: { sourceRevision: productSurfaceCoordinateSchema },
      required: ["sourceRevision"],
    },
    { properties: { contentHash: sha256Schema }, required: ["contentHash"] },
  ],
  additionalProperties: false,
} as const;

const searchGroupSchema = {
  type: "object",
  properties: {
    corpusClass: corpusClassSchema,
    ...productSurfaceSectionStateSchema.properties,
    hits: { type: "array", items: searchHitSchema, maxItems: 100 },
  },
  required: ["corpusClass", ...productSurfaceSectionStateSchema.required, "hits"],
  oneOf: productSurfaceSectionStateSchema.oneOf,
  additionalProperties: false,
} as const;

const searchStageReceiptSchema = {
  type: "object",
  properties: {
    stageId: productSurfaceCoordinateSchema,
    required: { type: "boolean" },
    status: { type: "string", enum: ["completed", "omitted", "failed"] },
    reasonCode: { anyOf: [productSurfaceReasonCodeSchema, { type: "null" }] },
    adapterId: adapterIdSchema,
    adapterBuildId: productSurfaceCoordinateSchema,
    receiptHash: sha256Schema,
  },
  required: [
    "stageId",
    "required",
    "status",
    "reasonCode",
    "adapterId",
    "adapterBuildId",
    "receiptHash",
  ],
  oneOf: [
    {
      properties: {
        status: { const: "completed" },
        reasonCode: { type: "null" },
      },
      required: ["status", "reasonCode"],
    },
    {
      properties: {
        required: { const: false },
        status: { const: "omitted" },
        reasonCode: productSurfaceReasonCodeSchema,
      },
      required: ["required", "status", "reasonCode"],
    },
    {
      properties: {
        status: { const: "failed" },
        reasonCode: productSurfaceReasonCodeSchema,
      },
      required: ["status", "reasonCode"],
    },
  ],
  additionalProperties: false,
} as const;

export const productUnifiedSearchResultSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/product-unified-search-result.schema.json",
  title: "Lervo product unified search result",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    kind: { const: "product_surface.search" },
    queryDigest: sha256Schema,
    authorizationDigest: sha256Schema,
    requestedCorpusClasses: {
      type: "array",
      items: corpusClassSchema,
      minItems: 1,
      maxItems: productSearchCorpusClasses.length,
      uniqueItems: true,
    },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    repositoryRevision: sha256Schema,
    searchPlan: {
      type: "object",
      properties: {
        coordinate: productSurfaceCoordinateSchema,
        contentHash: sha256Schema,
        engineId: productSurfaceCoordinateSchema,
        engineVersion: { type: "integer", minimum: 1 },
      },
      required: ["coordinate", "contentHash", "engineId", "engineVersion"],
      additionalProperties: false,
    },
    stageReceipts: {
      type: "array",
      items: searchStageReceiptSchema,
      minItems: 1,
      maxItems: 32,
    },
    groups: {
      type: "array",
      items: searchGroupSchema,
      maxItems: productSearchCorpusClasses.length,
    },
    status: { type: "string", enum: ["complete", "partial", "empty", "failed"] },
    reasonCode: { anyOf: [productSurfaceReasonCodeSchema, { type: "null" }] },
    resultDigest: sha256Schema,
  },
  required: [
    "schemaVersion",
    "kind",
    "queryDigest",
    "authorizationDigest",
    "requestedCorpusClasses",
    "limit",
    "repositoryRevision",
    "searchPlan",
    "stageReceipts",
    "groups",
    "status",
    "reasonCode",
    "resultDigest",
  ],
  oneOf: [
    {
      properties: {
        status: { enum: ["complete", "empty"] },
        reasonCode: { type: "null" },
        stageReceipts: {
          type: "array",
          items: {
            allOf: [
              searchStageReceiptSchema,
              {
                type: "object",
                properties: { status: { const: "completed" } },
                required: ["status"],
              },
            ],
          },
        },
      },
      required: ["status", "reasonCode", "stageReceipts"],
    },
    {
      properties: {
        status: { const: "partial" },
        reasonCode: productSurfaceReasonCodeSchema,
        stageReceipts: {
          type: "array",
          items: {
            allOf: [
              searchStageReceiptSchema,
              {
                not: {
                  type: "object",
                  properties: { status: { const: "failed" } },
                  required: ["status"],
                },
              },
            ],
          },
          contains: {
            type: "object",
            properties: { required: { const: false }, status: { const: "omitted" } },
            required: ["required", "status"],
          },
          minContains: 1,
        },
      },
      required: ["status", "reasonCode", "stageReceipts"],
    },
    {
      properties: {
        status: { const: "failed" },
        reasonCode: productSurfaceReasonCodeSchema,
        stageReceipts: {
          type: "array",
          items: searchStageReceiptSchema,
          contains: {
            type: "object",
            properties: { required: { const: true }, status: { const: "failed" } },
            required: ["required", "status"],
          },
          minContains: 1,
        },
      },
      required: ["status", "reasonCode", "stageReceipts"],
    },
  ],
  additionalProperties: false,
} as const;

export type ProductUnifiedSearchResultV1 = FromSchema<typeof productUnifiedSearchResultSchema>;
export type ProductSearchCorpusClass = (typeof productSearchCorpusClasses)[number];
