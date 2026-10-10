import type { FromSchema } from "json-schema-to-ts";
import { sha256Schema } from "./common.js";

const count = { type: "integer", minimum: 0, maximum: 64 } as const;
const nullableCount = { anyOf: [count, { type: "null" }] } as const;
export const instructionPreparationReportSchema = {
  type: "object",
  properties: {
    schemaVersion: { const: 1 },
    scope: { const: "applied_owner_rules" },
    status: { enum: ["complete", "incomplete", "unavailable"] },
    catalogDigest: { anyOf: [sha256Schema, { type: "null" }] },
    targetDigest: sha256Schema,
    observedCount: nullableCount,
    applicableCount: nullableCount,
    excludedCount: nullableCount,
    unresolvedCount: nullableCount,
    preparedCount: count,
    omittedCount: nullableCount,
    preparedByteCount: { type: "integer", minimum: 0, maximum: 1048576 },
    reasonCodes: {
      type: "array",
      maxItems: 7,
      uniqueItems: true,
      items: {
        enum: [
          "instruction_scope_unresolved",
          "instruction_capacity_insufficient",
          "instruction_source_unavailable",
          "instruction_source_changed",
          "instruction_catalog_overflow",
          "instruction_scope_invalid",
          "instruction_source_unsafe",
        ],
      },
    },
    delivery: { const: "unobserved" },
  },
  required: [
    "schemaVersion",
    "scope",
    "status",
    "catalogDigest",
    "targetDigest",
    "observedCount",
    "applicableCount",
    "excludedCount",
    "unresolvedCount",
    "preparedCount",
    "omittedCount",
    "preparedByteCount",
    "reasonCodes",
    "delivery",
  ],
  additionalProperties: false,
} as const;
export type InstructionPreparationReport = FromSchema<typeof instructionPreparationReportSchema>;
