import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema } from "./common.js";
import {
  productSurfaceCoordinateSchema,
  productSurfaceProjectionStatusSchema,
} from "./product-surface-common.js";
import {
  surfaceGroundingSectionSchema,
  surfaceSearchSectionSchema,
} from "./surface-observability-context-sections.js";
import {
  surfaceCachesSectionSchema,
  surfaceResourcesSectionSchema,
  surfaceStagesSectionSchema,
} from "./surface-observability-execution-sections.js";
import {
  surfaceCompletenessSchema,
  surfaceResultSectionSchema,
} from "./surface-observability-outcome-sections.js";

export const surfaceObservabilityReportSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/surface-observability-report.schema.json",
  title: "Lervo product surface observability report",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    kind: { const: "product_surface.observability" },
    surface: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["discord", "first_party", "local_cli", "other"] },
        adapterBuild: productSurfaceCoordinateSchema,
      },
      required: ["kind", "adapterBuild"],
      additionalProperties: false,
    },
    sourceEventHeadHash: sha256Schema,
    repositoryRevision: sha256Schema,
    workCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
    originCoordinate: { anyOf: [productSurfaceCoordinateSchema, { type: "null" }] },
    grounding: surfaceGroundingSectionSchema,
    search: surfaceSearchSectionSchema,
    resources: surfaceResourcesSectionSchema,
    stages: surfaceStagesSectionSchema,
    caches: surfaceCachesSectionSchema,
    result: surfaceResultSectionSchema,
    completeness: surfaceCompletenessSchema,
    status: productSurfaceProjectionStatusSchema,
    reportDigest: sha256Schema,
  },
  required: [
    "schemaVersion",
    "kind",
    "surface",
    "sourceEventHeadHash",
    "repositoryRevision",
    "workCoordinate",
    "originCoordinate",
    "grounding",
    "search",
    "resources",
    "stages",
    "caches",
    "result",
    "completeness",
    "status",
    "reportDigest",
  ],
  additionalProperties: false,
} as const;

export type SurfaceObservabilityReportV1 = FromSchema<typeof surfaceObservabilityReportSchema>;
