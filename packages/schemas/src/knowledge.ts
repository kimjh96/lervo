import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  deliberationArtifactIdSchema,
  deliberationClaimIdSchema,
  deliberationIdSchema,
  deliberationOutcomeIdSchema,
  eventIdSchema,
  knowledgeCandidateIdSchema,
  projectIdSchema,
  repositoryRelativePathSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
  verificationIdSchema,
} from "./common.js";

const artifactCoordinateSchema = {
  type: "object",
  properties: {
    artifactId: artifactIdSchema,
    uri: { type: "string", pattern: "^lervo-cas://sha256/[a-f0-9]{64}$" },
    mediaType: { type: "string", minLength: 1, maxLength: 200 },
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 1, maximum: 4_194_304 },
  },
  required: ["artifactId", "uri", "mediaType", "contentHash", "byteCount"],
  additionalProperties: false,
} as const;

const verificationEvidenceSchema = {
  type: "object",
  properties: {
    verificationArtifactId: deliberationArtifactIdSchema,
    verificationId: verificationIdSchema,
    resultArtifactId: artifactIdSchema,
    resultHash: sha256Schema,
    repositoryRevision: sha256Schema,
  },
  required: [
    "verificationArtifactId",
    "verificationId",
    "resultArtifactId",
    "resultHash",
    "repositoryRevision",
  ],
  additionalProperties: false,
} as const;

export const knowledgeCandidateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-candidate.schema.json",
  title: "Lervo evidence-bound knowledge candidate",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    candidateId: knowledgeCandidateIdSchema,
    projectId: projectIdSchema,
    status: { const: "candidate" },
    claim: {
      type: "object",
      properties: {
        claimId: deliberationClaimIdSchema,
        claimDigest: sha256Schema,
      },
      required: ["claimId", "claimDigest"],
      additionalProperties: false,
    },
    source: {
      type: "object",
      properties: {
        kind: { const: "converged_deliberation" },
        deliberationId: deliberationIdSchema,
        outcomeId: deliberationOutcomeIdSchema,
        decisionArtifactId: deliberationArtifactIdSchema,
        decisionContent: artifactCoordinateSchema,
      },
      required: ["kind", "deliberationId", "outcomeId", "decisionArtifactId", "decisionContent"],
      additionalProperties: false,
    },
    paths: {
      type: "array",
      items: { ...repositoryRelativePathSchema, maxLength: 500 },
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
    },
    evidence: {
      type: "object",
      properties: {
        eventIds: {
          type: "array",
          items: eventIdSchema,
          minItems: 1,
          maxItems: 200,
          uniqueItems: true,
        },
        verifications: {
          type: "array",
          items: verificationEvidenceSchema,
          minItems: 1,
          maxItems: 32,
        },
      },
      required: ["eventIds", "verifications"],
      additionalProperties: false,
    },
    verifiedRevision: sha256Schema,
    reviewIntervalDays: { type: "integer", minimum: 1, maximum: 3650 },
    conflictCandidateIds: {
      type: "array",
      items: knowledgeCandidateIdSchema,
      maxItems: 100,
      uniqueItems: true,
    },
    createdAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "candidateId",
    "projectId",
    "status",
    "claim",
    "source",
    "paths",
    "evidence",
    "verifiedRevision",
    "reviewIntervalDays",
    "conflictCandidateIds",
    "createdAt",
  ],
  additionalProperties: false,
} as const;

export type KnowledgeCandidate = FromSchema<typeof knowledgeCandidateSchema>;
