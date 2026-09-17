import { sha256Schema } from "./common.js";
import {
  productSurfaceCoordinateSchema,
  productSurfaceReasonCodeSchema,
  productSurfaceSectionStateSchema,
} from "./product-surface-common.js";

const sectionProperties = productSurfaceSectionStateSchema.properties;
const sectionRequired = productSurfaceSectionStateSchema.required;
const sectionAlternatives = productSurfaceSectionStateSchema.oneOf;

export const surfaceResultSectionSchema = {
  type: "object",
  properties: {
    ...sectionProperties,
    terminalStatus: {
      anyOf: [
        { type: "string", enum: ["completed", "failed", "blocked", "cancelled", "unknown"] },
        { type: "null" },
      ],
    },
    verificationStatus: {
      type: "string",
      enum: ["passed", "failed", "not_run", "unavailable", "invalid"],
    },
    acceptanceStatus: {
      type: "string",
      enum: ["accepted", "rework", "pending", "unavailable", "invalid"],
    },
    artifactStatus: {
      type: "string",
      enum: ["available", "missing", "unavailable", "invalid"],
    },
    publicationStatus: {
      type: "string",
      enum: ["not_requested", "pending", "published", "blocked", "failed", "uncertain"],
    },
    deliveryStatus: {
      type: "string",
      enum: ["not_requested", "pending", "delivered", "failed", "uncertain"],
    },
    resultDigest: { anyOf: [sha256Schema, { type: "null" }] },
    artifactCoordinates: {
      type: "array",
      items: productSurfaceCoordinateSchema,
      maxItems: 100,
      uniqueItems: true,
    },
    verificationCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
    acceptanceCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
    publicationCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
    deliveryCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
  },
  required: [
    ...sectionRequired,
    "terminalStatus",
    "verificationStatus",
    "acceptanceStatus",
    "artifactStatus",
    "publicationStatus",
    "deliveryStatus",
    "resultDigest",
    "artifactCoordinates",
    "verificationCoordinate",
    "acceptanceCoordinate",
    "publicationCoordinate",
    "deliveryCoordinate",
  ],
  oneOf: sectionAlternatives,
  additionalProperties: false,
} as const;

export const surfaceCompletenessSchema = {
  type: "object",
  properties: {
    requiredSections: {
      type: "array",
      items: {
        type: "string",
        enum: ["grounding", "search", "resources", "stages", "caches", "result"],
      },
      minItems: 1,
      maxItems: 6,
      uniqueItems: true,
    },
    missingReasons: {
      type: "array",
      items: productSurfaceReasonCodeSchema,
      maxItems: 32,
      uniqueItems: true,
    },
  },
  required: ["requiredSections", "missingReasons"],
  additionalProperties: false,
} as const;
