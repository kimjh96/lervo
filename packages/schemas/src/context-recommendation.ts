import type { FromSchema } from "json-schema-to-ts";

import { documentIdSchema, sha256Schema } from "./common.js";
import { knowledgeContextSchema } from "./knowledge-context.js";

export const contextRecommendationProperties = {
  recommendationId: { type: "string", pattern: "^srec_[a-f0-9]{24}$" },
  batchId: { type: "string", pattern: "^srb_[a-f0-9]{24}$" },
  sourceAttemptId: { type: "string", pattern: "^sat_[a-f0-9]{24}$" },
  engineId: { type: "string", pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$", maxLength: 64 },
  engineVersion: { type: "integer", minimum: 1, maximum: 1_000_000 },
  selectionTransitionId: {
    anyOf: [
      { type: "string", pattern: "^seact_[a-f0-9]{24}$" },
      { type: "null" },
    ],
  },
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
  "selectionTransitionId",
  "indexId",
  "resultSetHash",
  "sourceContentHash",
  "rank",
  "score",
  "selectionPolicyId",
  "selectionPolicyVersion",
  "selectionMaximum",
] as const;

const legacyContextRecommendationEventRequired = contextRecommendationRequired.filter(
  (field): field is Exclude<(typeof contextRecommendationRequired)[number], "selectionTransitionId"> =>
    field !== "selectionTransitionId",
);

export const contextRecommendationEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/context-recommendation-event-payload.schema.json",
  title: "Lervo context recommendation event payload",
  type: "object",
  properties: { ...contextRecommendationProperties, documentId: documentIdSchema, knowledgeContext: knowledgeContextSchema },
  required: [...legacyContextRecommendationEventRequired, "documentId"],
  additionalProperties: false,
} as const;

export type ContextRecommendationEventPayload = FromSchema<
  typeof contextRecommendationEventPayloadSchema
>;
