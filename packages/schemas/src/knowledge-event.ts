import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  deliberationArtifactIdSchema,
  deliberationOutcomeIdSchema,
  eventIdSchema,
  knowledgeCandidateIdSchema,
  knowledgeReviewApprovalIdSchema,
  knowledgeStalenessResultIdSchema,
  repositoryRelativePathSchema,
  sha256Schema,
  timestampSchema,
  verifiedKnowledgeIdSchema,
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

export const knowledgeCandidateReviewedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-candidate-reviewed-event-payload.schema.json",
  type: "object",
  properties: {
    candidateId: knowledgeCandidateIdSchema,
    candidateContentHash: sha256Schema,
    approvalId: knowledgeReviewApprovalIdSchema,
    approvalArtifactId: artifactIdSchema,
    approvalContentHash: sha256Schema,
    decision: { type: "string", enum: ["approved", "rejected"] },
    policyId: {
      type: "string",
      pattern: "^knowledge_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
      maxLength: 150,
    },
    policyVersion: sha256Schema,
    itemApprovalDigest: sha256Schema,
    repositoryRevision: sha256Schema,
    resolvedConflictCandidateIds: {
      type: "array",
      items: knowledgeCandidateIdSchema,
      maxItems: 100,
      uniqueItems: true,
    },
  },
  required: [
    "candidateId",
    "candidateContentHash",
    "approvalId",
    "approvalArtifactId",
    "approvalContentHash",
    "decision",
    "policyId",
    "policyVersion",
    "repositoryRevision",
    "resolvedConflictCandidateIds",
  ],
  additionalProperties: false,
} as const;

export const knowledgeVerifiedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-verified-event-payload.schema.json",
  type: "object",
  properties: {
    knowledgeId: verifiedKnowledgeIdSchema,
    candidateId: knowledgeCandidateIdSchema,
    candidateContentHash: sha256Schema,
    approvalId: knowledgeReviewApprovalIdSchema,
    approvalContentHash: sha256Schema,
    claimDigest: sha256Schema,
    paths: {
      type: "array",
      items: { ...repositoryRelativePathSchema, maxLength: 500 },
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
    },
    verifiedRevision: sha256Schema,
    knowledgeArtifactId: artifactIdSchema,
    knowledgeContentHash: sha256Schema,
  },
  required: [
    "knowledgeId",
    "candidateId",
    "candidateContentHash",
    "approvalId",
    "approvalContentHash",
    "claimDigest",
    "paths",
    "verifiedRevision",
    "knowledgeArtifactId",
    "knowledgeContentHash",
  ],
  additionalProperties: false,
} as const;

export const knowledgeStaleDetectedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-stale-detected-event-payload.schema.json",
  type: "object",
  properties: {
    knowledgeId: verifiedKnowledgeIdSchema,
    resultId: knowledgeStalenessResultIdSchema,
    verifiedRevision: sha256Schema,
    currentRevision: sha256Schema,
    reasons: {
      type: "array",
      items: {
        type: "string",
        enum: ["review_interval_elapsed", "linked_path_changed", "linked_path_missing"],
      },
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
    },
    changedPaths: {
      type: "array",
      items: { ...repositoryRelativePathSchema, maxLength: 500 },
      maxItems: 100,
      uniqueItems: true,
    },
    missingPaths: {
      type: "array",
      items: { ...repositoryRelativePathSchema, maxLength: 500 },
      maxItems: 100,
      uniqueItems: true,
    },
    resultArtifactId: artifactIdSchema,
    resultContentHash: sha256Schema,
  },
  required: [
    "knowledgeId",
    "resultId",
    "verifiedRevision",
    "currentRevision",
    "reasons",
    "changedPaths",
    "missingPaths",
    "resultArtifactId",
    "resultContentHash",
  ],
  additionalProperties: false,
} as const;

export type KnowledgeCandidateReviewedEventPayload = FromSchema<
  typeof knowledgeCandidateReviewedEventPayloadSchema
>;

export const knowledgeReconciliationReviewedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-reconciliation-reviewed-event-payload.schema.json",
  type: "object",
  properties: {
    compilationId: { type: "string", pattern: "^kcomp_[a-f0-9]{24}$" },
    candidateArtifactHash: sha256Schema,
    reconciliationPlanId: { type: "string", pattern: "^krecon_[a-f0-9]{24}$" },
    sourceSnapshotId: { type: "string", pattern: "^ksnap_[a-f0-9]{24}$" },
    registryDigest: sha256Schema,
    reviewId: { type: "string", pattern: "^krvw_[a-f0-9]{24}$" },
    reviewArtifactId: artifactIdSchema,
    reviewArtifactHash: sha256Schema,
    decision: { type: "string", enum: ["approved", "rejected"] },
    policyId: {
      type: "string",
      pattern: "^knowledge_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
      maxLength: 150,
    },
    policyVersion: sha256Schema,
    itemApprovalDigest: sha256Schema,
    acceptedDispositionIds: {
      type: "array",
      items: { type: "string", pattern: "^kdisp_[a-f0-9]{24}$" },
      maxItems: 256,
      uniqueItems: true,
    },
    skippedDispositionIds: {
      type: "array",
      items: { type: "string", pattern: "^kdisp_[a-f0-9]{24}$" },
      maxItems: 256,
      uniqueItems: true,
    },
    dispositionListTruncated: { type: "boolean" },
    dispositionCount: { type: "integer", minimum: 0, maximum: 20000 },
    reviewedAt: timestampSchema,
  },
  required: [
    "compilationId",
    "candidateArtifactHash",
    "reconciliationPlanId",
    "sourceSnapshotId",
    "registryDigest",
    "reviewId",
    "reviewArtifactId",
    "reviewArtifactHash",
    "decision",
    "policyId",
    "policyVersion",
    "itemApprovalDigest",
    "acceptedDispositionIds",
    "skippedDispositionIds",
    "dispositionListTruncated",
    "dispositionCount",
    "reviewedAt",
  ],
  additionalProperties: false,
} as const;

export type KnowledgeReconciliationReviewedEventPayload = FromSchema<
  typeof knowledgeReconciliationReviewedEventPayloadSchema
>;
export type KnowledgeVerifiedEventPayload = FromSchema<typeof knowledgeVerifiedEventPayloadSchema>;
export type KnowledgeStaleDetectedEventPayload = FromSchema<
  typeof knowledgeStaleDetectedEventPayloadSchema
>;
