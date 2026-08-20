import type { FromSchema } from "json-schema-to-ts";

import { documentIdSchema, sha256Schema } from "./common.js";

export const contextRecommendationProperties = {
  recommendationId: { type: "string", pattern: "^srec_[a-f0-9]{24}$" },
  batchId: { type: "string", pattern: "^srb_[a-f0-9]{24}$" },
  sourceAttemptId: { type: "string", pattern: "^sat_[a-f0-9]{24}$" },
  engineId: { const: "lexical" },
  engineVersion: { const: 1 },
  indexId: { type: "string", pattern: "^sidx_[a-f0-9]{24}$" },
  resultSetHash: sha256Schema,
  sourceContentHash: sha256Schema,
  rank: { type: "integer", minimum: 1, maximum: 50 },
  score: { type: "integer", minimum: 1 },
  selectionPolicyId: { const: "top_ranked" },
  selectionPolicyVersion: { const: 1 },
  selectionMaximum: { type: "integer", minimum: 0, maximum: 5 },
} as const;

export const contextRecommendationRequired = [
  "recommendationId",
  "batchId",
  "sourceAttemptId",
  "engineId",
  "engineVersion",
  "indexId",
  "resultSetHash",
  "sourceContentHash",
  "rank",
  "score",
  "selectionPolicyId",
  "selectionPolicyVersion",
  "selectionMaximum",
] as const;

export const contextRecommendationEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/context-recommendation-event-payload.schema.json",
  title: "Lervo context recommendation event payload",
  type: "object",
  properties: { ...contextRecommendationProperties, documentId: documentIdSchema },
  required: [...contextRecommendationRequired, "documentId"],
  additionalProperties: false,
} as const;

export type ContextRecommendationEventPayload = FromSchema<
  typeof contextRecommendationEventPayloadSchema
>;
