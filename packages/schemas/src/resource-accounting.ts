import type { FromSchema } from "json-schema-to-ts";

import { adapterIdSchema } from "./adapter-primitives.js";
import { providerSchema } from "./common.js";

const reasonCodeSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,63}$",
} as const;

export const resourceAccountingModeSchema = {
  type: "string",
  enum: ["turn_cumulative", "session_cumulative", "operation_delta"],
} as const;

export const resourceAccountingDescriptorShape = {
  type: "object",
  properties: {
    kind: { const: "resource_accounting_descriptor" },
    schemaVersion: { type: "integer", const: 1 },
    provider: providerSchema,
    adapterId: adapterIdSchema,
    adapterVersion: { type: "string", minLength: 1 },
    accountingMode: resourceAccountingModeSchema,
    observationSupport: { type: "string", enum: ["supported", "unavailable"] },
    unavailableReason: { anyOf: [reasonCodeSchema, { type: "null" }] },
    normalizationId: { type: "string", pattern: "^[a-z][a-z0-9_.-]{0,127}$" },
    nativeCounterSemanticsId: { type: "string", pattern: "^[a-z][a-z0-9_.-]{0,127}$" },
    model: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    serviceTier: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
  },
  required: [
    "kind",
    "schemaVersion",
    "provider",
    "adapterId",
    "adapterVersion",
    "accountingMode",
    "observationSupport",
    "unavailableReason",
    "normalizationId",
    "nativeCounterSemanticsId",
    "model",
    "serviceTier",
  ],
  oneOf: [
    {
      properties: {
        observationSupport: { const: "supported" },
        unavailableReason: { type: "null" },
      },
      required: ["observationSupport", "unavailableReason"],
    },
    {
      properties: {
        observationSupport: { const: "unavailable" },
        unavailableReason: reasonCodeSchema,
      },
      required: ["observationSupport", "unavailableReason"],
    },
  ],
  additionalProperties: false,
} as const;

export const resourceAccountingDescriptorSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/resource-accounting-descriptor.schema.json",
  ...resourceAccountingDescriptorShape,
} as const;

export type ResourceAccountingMode = FromSchema<typeof resourceAccountingModeSchema>;
export type ResourceAccountingDescriptor = FromSchema<typeof resourceAccountingDescriptorSchema>;
