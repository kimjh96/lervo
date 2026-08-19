import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  localeSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
  writingEvaluationIdSchema,
  writingPolicyIdSchema,
} from "./common.js";

const writingCheckResultSchema = {
  type: "object",
  properties: {
    checkId: { type: "string", minLength: 1, maxLength: 150 },
    kind: { type: "string", enum: ["deterministic", "semantic"] },
    status: { type: "string", enum: ["passed", "failed", "not_run"] },
    violationCount: { type: "integer", minimum: 0 },
    evidenceDigest: { anyOf: [sha256Schema, { type: "null" }] },
  },
  required: ["checkId", "kind", "status", "violationCount", "evidenceDigest"],
  additionalProperties: false,
} as const;

export const writingEvaluationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/writing-evaluation.schema.json",
  title: "Lervo writing verification result",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    evaluationId: writingEvaluationIdSchema,
    writingPolicyId: writingPolicyIdSchema,
    artifactId: artifactIdSchema,
    contentHash: sha256Schema,
    locale: localeSchema,
    checkedAt: timestampSchema,
    evaluators: {
      type: "array",
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              kind: { const: "deterministic" },
              evaluatorId: { type: "string", minLength: 1, maxLength: 150 },
            },
            required: ["kind", "evaluatorId"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["model", "human"] },
              evaluatorId: { type: "string", minLength: 1, maxLength: 150 },
              phase: { const: "separate_pass" },
            },
            required: ["kind", "evaluatorId", "phase"],
            additionalProperties: false,
          },
        ],
      },
      minItems: 1,
      uniqueItems: true,
    },
    checks: {
      type: "array",
      items: writingCheckResultSchema,
      minItems: 1,
      uniqueItems: true,
    },
    overallStatus: { type: "string", enum: ["passed", "failed", "incomplete"] },
  },
  required: [
    "schemaVersion",
    "evaluationId",
    "writingPolicyId",
    "artifactId",
    "contentHash",
    "locale",
    "checkedAt",
    "evaluators",
    "checks",
    "overallStatus",
  ],
  additionalProperties: false,
} as const;

export type WritingEvaluation = FromSchema<typeof writingEvaluationSchema>;
export type WritingCheckResult = FromSchema<typeof writingCheckResultSchema>;
