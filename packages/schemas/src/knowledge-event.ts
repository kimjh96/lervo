import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  deliberationArtifactIdSchema,
  deliberationOutcomeIdSchema,
  eventIdSchema,
  knowledgeCandidateIdSchema,
  repositoryRelativePathSchema,
  sha256Schema,
} from "./common.js";

export const knowledgeCandidateCreatedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-candidate-created-event-payload.schema.json",
  type: "object",
  properties: {
    candidateId: knowledgeCandidateIdSchema,
    claimDigest: sha256Schema,
    paths: {
      type: "array",
      items: { ...repositoryRelativePathSchema, maxLength: 500 },
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
    },
    evidenceIds: {
      type: "array",
      items: eventIdSchema,
      minItems: 1,
      maxItems: 200,
      uniqueItems: true,
    },
    sourceOutcomeId: deliberationOutcomeIdSchema,
    decisionArtifactId: deliberationArtifactIdSchema,
    verificationArtifactIds: {
      type: "array",
      items: deliberationArtifactIdSchema,
      minItems: 1,
      maxItems: 32,
      uniqueItems: true,
    },
    verifiedRevision: sha256Schema,
    candidateArtifactId: artifactIdSchema,
    candidateContentHash: sha256Schema,
  },
  required: [
    "candidateId",
    "claimDigest",
    "paths",
    "evidenceIds",
    "sourceOutcomeId",
    "decisionArtifactId",
    "verificationArtifactIds",
    "verifiedRevision",
    "candidateArtifactId",
    "candidateContentHash",
  ],
  additionalProperties: false,
} as const;

export type KnowledgeCandidateCreatedEventPayload = FromSchema<
  typeof knowledgeCandidateCreatedEventPayloadSchema
>;
