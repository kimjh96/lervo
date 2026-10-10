import { instructionPreparationReportSchema } from "./instruction-preparation-report.js";
import { contextQualityReadinessSchema } from "./context-quality-readiness.js";
import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema } from "./common.js";

export const contextPreparationReasonCodes = [
  "retrieval_not_run",
  "retrieval_unavailable",
  "loading_unobserved",
  "corpus_incomplete",
  "source_unavailable",
  "source_unsafe",
  "source_oversized",
  "source_changed",
  "source_invalid_utf8",
  "capacity_exhausted",
  "prefix_only",
] as const;

const count = { type: "integer", minimum: 0, maximum: 50 } as const;
const nullableCount = { anyOf: [count, { type: "null" }] } as const;

/** Baseline diagnostics only; deliberately not a ContextQualityPlanV1 or delivery receipt. */
export const contextPreparationReportSchema = {
  $id: "https://lervo.dev/schemas/context-preparation-report.v1.json",
  type: "object",
  properties: {
    planningReadiness: contextQualityReadinessSchema,
    instructions: instructionPreparationReportSchema,
    schemaVersion: { const: 1 },
    contractId: { const: "context_preparation_observation_v1" },
    requestDigest: sha256Schema,
    sourceSnapshotId: {
      anyOf: [{ type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" }, { type: "null" }],
    },
    observationDigest: sha256Schema,
    retrieval: { enum: ["completed", "not_run", "unavailable"] },
    candidateCount: nullableCount,
    selectedCount: count,
    loading: { enum: ["observed", "unobserved"] },
    fullCount: nullableCount,
    prefixCount: nullableCount,
    unavailableCount: nullableCount,
    preparedByteCount: {
      anyOf: [{ type: "integer", minimum: 0, maximum: 6553600 }, { type: "null" }],
    },
    reasonCodes: {
      type: "array",
      items: { enum: contextPreparationReasonCodes },
      maxItems: contextPreparationReasonCodes.length,
      uniqueItems: true,
    },
    applicability: { const: "unobserved" },
    corpusCoverage: { enum: ["unobserved", "incomplete"] },
    delivery: { const: "unobserved" },
    internalUse: { const: "unknown" },
    artifactCompliance: { const: "unobserved" },
  },
  required: [
    "schemaVersion",
    "contractId",
    "requestDigest",
    "sourceSnapshotId",
    "observationDigest",
    "retrieval",
    "candidateCount",
    "selectedCount",
    "loading",
    "fullCount",
    "prefixCount",
    "unavailableCount",
    "preparedByteCount",
    "reasonCodes",
    "applicability",
    "corpusCoverage",
    "delivery",
    "internalUse",
    "artifactCompliance",
  ],
  additionalProperties: false,
} as const;

export type ContextPreparationReport = FromSchema<typeof contextPreparationReportSchema>;
export type ContextPreparationReasonCode = (typeof contextPreparationReasonCodes)[number];
