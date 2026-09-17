import { adapterIdSchema } from "./adapter-primitives.js";
import { sha256Schema } from "./common.js";
import {
  productSurfaceCoordinateSchema,
  productSurfaceReasonCodeSchema,
  productSurfaceSectionStateSchema,
} from "./product-surface-common.js";

const sectionProperties = productSurfaceSectionStateSchema.properties;
const sectionRequired = productSurfaceSectionStateSchema.required;
const sectionAlternatives = productSurfaceSectionStateSchema.oneOf;

const coverageRatioSchema = {
  type: "object",
  properties: {
    numerator: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    denominator: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    value: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] },
    reasonCode: { anyOf: [productSurfaceReasonCodeSchema, { type: "null" }] },
  },
  required: ["numerator", "denominator", "value", "reasonCode"],
  oneOf: [
    {
      properties: {
        numerator: { type: "integer", minimum: 0 },
        denominator: { type: "integer", minimum: 0 },
        value: { type: "number", minimum: 0, maximum: 1 },
        reasonCode: { type: "null" },
      },
      required: ["numerator", "denominator", "value", "reasonCode"],
    },
    {
      properties: {
        numerator: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        denominator: { type: "null" },
        value: { type: "null" },
        reasonCode: productSurfaceReasonCodeSchema,
      },
      required: ["numerator", "denominator", "value", "reasonCode"],
    },
  ],
  additionalProperties: false,
} as const;

export const surfaceGroundingSectionSchema = {
  type: "object",
  properties: {
    ...sectionProperties,
    reportCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
    documentCounts: {
      type: "object",
      properties: {
        recommended: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        selected: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        loaded: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        injected: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        referenced: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
      },
      required: ["recommended", "selected", "loaded", "injected", "referenced"],
      additionalProperties: false,
    },
    coverage: {
      type: "object",
      properties: {
        delivery: coverageRatioSchema,
        explicitReference: coverageRatioSchema,
        relevance: coverageRatioSchema,
        candidateSelection: coverageRatioSchema,
      },
      required: ["delivery", "explicitReference", "relevance", "candidateSelection"],
      additionalProperties: false,
    },
  },
  required: [...sectionRequired, "reportCoordinate", "documentCounts", "coverage"],
  oneOf: sectionAlternatives,
  additionalProperties: false,
} as const;

const searchEngineObservationSchema = {
  type: "object",
  properties: {
    engineId: productSurfaceCoordinateSchema,
    engineVersion: { type: "integer", minimum: 1 },
    adapterId: adapterIdSchema,
    adapterBuildId: productSurfaceCoordinateSchema,
    qualificationOrTransitionCoordinate: productSurfaceCoordinateSchema,
    sourceRevision: sha256Schema,
    preparationState: { type: "string", enum: ["cold", "warm", "reused"] },
  },
  required: [
    "engineId",
    "engineVersion",
    "adapterId",
    "adapterBuildId",
    "qualificationOrTransitionCoordinate",
    "sourceRevision",
    "preparationState",
  ],
  additionalProperties: false,
} as const;

export const surfaceSearchSectionSchema = {
  type: "object",
  properties: {
    ...sectionProperties,
    resultCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
    engine: { anyOf: [searchEngineObservationSchema, { type: "null" }] },
    queryDurationMs: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
    orderedHitCoordinates: {
      type: "array",
      items: productSurfaceCoordinateSchema,
      maxItems: 100,
      uniqueItems: true,
    },
  },
  required: [
    ...sectionRequired,
    "resultCoordinate",
    "engine",
    "queryDurationMs",
    "orderedHitCoordinates",
  ],
  oneOf: sectionAlternatives,
  additionalProperties: false,
} as const;
