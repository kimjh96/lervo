import { sha256Schema } from "./common.js";
import {
  executionStageObservationSchema,
  resourceUsageSchema,
} from "./execution-observability-event.js";
import {
  productSurfaceCoordinateSchema,
  productSurfaceReasonCodeSchema,
  productSurfaceSectionStateSchema,
} from "./product-surface-common.js";
import { resourceAccountingModeSchema } from "./resource-accounting.js";

const sectionProperties = productSurfaceSectionStateSchema.properties;
const sectionRequired = productSurfaceSectionStateSchema.required;
const sectionAlternatives = productSurfaceSectionStateSchema.oneOf;

const surfaceResourceScopeSchema = {
  type: "string",
  enum: [
    "primary_provider",
    "subagent_provider",
    "query_projection",
    "publication_evaluation",
    "deliberation",
    "improvement_evaluation",
  ],
} as const;

const resourceObservationSchema = {
  type: "object",
  properties: {
    provider: { type: "string", minLength: 1, maxLength: 64 },
    scope: surfaceResourceScopeSchema,
    accountingMode: resourceAccountingModeSchema,
    accountingDescriptorHash: sha256Schema,
    status: { type: "string", enum: ["observed", "partial", "unavailable", "invalid"] },
    usage: { anyOf: [resourceUsageSchema, { type: "null" }] },
    reasonCode: { anyOf: [productSurfaceReasonCodeSchema, { type: "null" }] },
    sourceCoordinates: {
      type: "array",
      items: productSurfaceCoordinateSchema,
      minItems: 1,
      maxItems: 32,
      uniqueItems: true,
    },
  },
  required: [
    "provider",
    "scope",
    "accountingMode",
    "accountingDescriptorHash",
    "status",
    "usage",
    "reasonCode",
    "sourceCoordinates",
  ],
  oneOf: [
    {
      properties: {
        status: { const: "observed" },
        usage: resourceUsageSchema,
        reasonCode: { type: "null" },
      },
      required: ["status", "usage", "reasonCode"],
    },
    {
      properties: {
        status: { const: "partial" },
        usage: resourceUsageSchema,
        reasonCode: productSurfaceReasonCodeSchema,
      },
      required: ["status", "usage", "reasonCode"],
    },
    {
      properties: {
        status: { enum: ["unavailable", "invalid"] },
        usage: { type: "null" },
        reasonCode: productSurfaceReasonCodeSchema,
      },
      required: ["status", "usage", "reasonCode"],
    },
  ],
  additionalProperties: false,
} as const;

export const surfaceResourcesSectionSchema = {
  type: "object",
  properties: {
    ...sectionProperties,
    groups: { type: "array", items: resourceObservationSchema, maxItems: 256 },
  },
  required: [...sectionRequired, "groups"],
  oneOf: sectionAlternatives,
  additionalProperties: false,
} as const;

export const surfaceStagesSectionSchema = {
  type: "object",
  properties: {
    ...sectionProperties,
    stageCatalogVersion: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    environmentProfileDigest: { anyOf: [sha256Schema, { type: "null" }] },
    repositoryProfile: {
      anyOf: [{ type: "string", enum: ["small", "medium", "large", "custom"] }, { type: "null" }],
    },
    observations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          runCoordinate: productSurfaceCoordinateSchema,
          occurrenceCount: { type: "integer", minimum: 1 },
          observation: executionStageObservationSchema,
        },
        required: ["runCoordinate", "occurrenceCount", "observation"],
        additionalProperties: false,
      },
      maxItems: 512,
    },
  },
  required: [
    ...sectionRequired,
    "stageCatalogVersion",
    "environmentProfileDigest",
    "repositoryProfile",
    "observations",
  ],
  oneOf: sectionAlternatives,
  additionalProperties: false,
} as const;

const cacheObservationSchema = {
  type: "object",
  properties: {
    cacheKind: productSurfaceCoordinateSchema,
    owner: productSurfaceCoordinateSchema,
    unit: { type: "string", enum: ["tokens", "bytes", "entries", "documents", "calls"] },
    status: { type: "string", enum: ["observed", "unavailable", "invalid"] },
    observedValue: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
    reasonCode: { anyOf: [productSurfaceReasonCodeSchema, { type: "null" }] },
    sourceRevision: sha256Schema,
    buildCoordinate: productSurfaceCoordinateSchema,
    disposition: { type: "string", enum: ["cold", "warm", "not_applicable", "unknown"] },
  },
  required: [
    "cacheKind",
    "owner",
    "unit",
    "status",
    "observedValue",
    "reasonCode",
    "sourceRevision",
    "buildCoordinate",
    "disposition",
  ],
  oneOf: [
    {
      properties: {
        status: { const: "observed" },
        observedValue: { type: "number", minimum: 0 },
        reasonCode: { type: "null" },
      },
      required: ["status", "observedValue", "reasonCode"],
    },
    {
      properties: {
        status: { enum: ["unavailable", "invalid"] },
        observedValue: { type: "null" },
        reasonCode: productSurfaceReasonCodeSchema,
      },
      required: ["status", "observedValue", "reasonCode"],
    },
  ],
  additionalProperties: false,
} as const;

export const surfaceCachesSectionSchema = {
  type: "object",
  properties: {
    ...sectionProperties,
    entries: { type: "array", items: cacheObservationSchema, maxItems: 256 },
  },
  required: [...sectionRequired, "entries"],
  oneOf: sectionAlternatives,
  additionalProperties: false,
} as const;
