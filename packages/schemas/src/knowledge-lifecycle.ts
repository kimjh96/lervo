import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  eventIdSchema,
  knowledgeCandidateIdSchema,
  knowledgeReviewApprovalIdSchema,
  knowledgeStalenessResultIdSchema,
  projectIdSchema,
  repositoryRelativePathSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
  verifiedKnowledgeIdSchema,
} from "./common.js";

const reviewerIdSchema = {
  type: "string",
  pattern: "^[A-Za-z0-9][A-Za-z0-9_.@-]{2,99}$",
} as const;

const knowledgePolicyIdSchema = {
  type: "string",
  pattern: "^knowledge_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
  maxLength: 150,
} as const;

const artifactCoordinateSchema = {
  type: "object",
  properties: {
    artifactId: artifactIdSchema,
    uri: { type: "string", pattern: "^lervo-cas://sha256/[a-f0-9]{64}$" },
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 1, maximum: 4_194_304 },
  },
  required: ["artifactId", "uri", "contentHash", "byteCount"],
  additionalProperties: false,
} as const;

const knowledgePromotionPolicyProperties = {
  schemaVersion: schemaVersionSchema,
  policyId: knowledgePolicyIdSchema,
  policyVersion: sha256Schema,
  allowedReviewerIds: {
    type: "array",
    items: reviewerIdSchema,
    minItems: 1,
    maxItems: 100,
    uniqueItems: true,
  },
  requireHumanReviewer: { const: true },
  requireResolvedConflicts: { type: "boolean" },
} as const;

const knowledgePromotionPolicyRequired = [
  "schemaVersion",
  "policyId",
  "policyVersion",
  "allowedReviewerIds",
  "requireHumanReviewer",
  "requireResolvedConflicts",
] as const;

export const knowledgePromotionPolicySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-promotion-policy.schema.json",
  title: "Lervo knowledge promotion policy",
  type: "object",
  properties: knowledgePromotionPolicyProperties,
  required: knowledgePromotionPolicyRequired,
  additionalProperties: false,
} as const;

export const knowledgeReviewApprovalSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-review-approval.schema.json",
  title: "Lervo immutable knowledge review approval",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    approvalId: knowledgeReviewApprovalIdSchema,
    projectId: projectIdSchema,
    candidateId: knowledgeCandidateIdSchema,
    candidateContentHash: sha256Schema,
    decision: { type: "string", enum: ["approved", "rejected"] },
    reviewer: {
      type: "object",
      properties: {
        kind: { const: "human" },
        reviewerId: reviewerIdSchema,
      },
      required: ["kind", "reviewerId"],
      additionalProperties: false,
    },
    policy: {
      type: "object",
      properties: knowledgePromotionPolicyProperties,
      required: knowledgePromotionPolicyRequired,
      additionalProperties: false,
    },
    repositoryRevision: sha256Schema,
    resolvedConflictCandidateIds: {
      type: "array",
      items: knowledgeCandidateIdSchema,
      maxItems: 100,
      uniqueItems: true,
    },
    reviewedAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "approvalId",
    "projectId",
    "candidateId",
    "candidateContentHash",
    "decision",
    "reviewer",
    "policy",
    "repositoryRevision",
    "resolvedConflictCandidateIds",
    "reviewedAt",
  ],
  additionalProperties: false,
} as const;

export const verifiedKnowledgeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/verified-knowledge.schema.json",
  title: "Lervo verified knowledge record",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    knowledgeId: verifiedKnowledgeIdSchema,
    projectId: projectIdSchema,
    status: { const: "verified" },
    candidate: {
      type: "object",
      properties: {
        candidateId: knowledgeCandidateIdSchema,
        artifact: artifactCoordinateSchema,
      },
      required: ["candidateId", "artifact"],
      additionalProperties: false,
    },
    approval: {
      type: "object",
      properties: {
        approvalId: knowledgeReviewApprovalIdSchema,
        artifact: artifactCoordinateSchema,
      },
      required: ["approvalId", "artifact"],
      additionalProperties: false,
    },
    claim: {
      type: "object",
      properties: {
        claimId: { type: "string", pattern: "^clm_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$" },
        claimDigest: sha256Schema,
      },
      required: ["claimId", "claimDigest"],
      additionalProperties: false,
    },
    paths: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { ...repositoryRelativePathSchema, maxLength: 500 },
          contentHash: sha256Schema,
        },
        required: ["path", "contentHash"],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 100,
    },
    evidenceEventIds: {
      type: "array",
      items: eventIdSchema,
      minItems: 2,
      maxItems: 202,
      uniqueItems: true,
    },
    verifiedRevision: sha256Schema,
    reviewIntervalDays: { type: "integer", minimum: 1, maximum: 3650 },
    verifiedAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "knowledgeId",
    "projectId",
    "status",
    "candidate",
    "approval",
    "claim",
    "paths",
    "evidenceEventIds",
    "verifiedRevision",
    "reviewIntervalDays",
    "verifiedAt",
  ],
  additionalProperties: false,
} as const;

export const knowledgeStalenessResultSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-staleness-result.schema.json",
  title: "Lervo knowledge staleness result",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    resultId: knowledgeStalenessResultIdSchema,
    projectId: projectIdSchema,
    knowledgeId: verifiedKnowledgeIdSchema,
    evaluatedAt: timestampSchema,
    status: { type: "string", enum: ["current", "stale"] },
    verifiedRevision: sha256Schema,
    currentRevision: sha256Schema,
    signals: {
      type: "object",
      properties: {
        reviewInterval: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["current", "stale"] },
            dueAt: timestampSchema,
          },
          required: ["status", "dueAt"],
          additionalProperties: false,
        },
        paths: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["current", "stale"] },
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
          },
          required: ["status", "changedPaths", "missingPaths"],
          additionalProperties: false,
        },
      },
      required: ["reviewInterval", "paths"],
      additionalProperties: false,
    },
    reasons: {
      type: "array",
      items: {
        type: "string",
        enum: ["review_interval_elapsed", "linked_path_changed", "linked_path_missing"],
      },
      maxItems: 3,
      uniqueItems: true,
    },
  },
  required: [
    "schemaVersion",
    "resultId",
    "projectId",
    "knowledgeId",
    "evaluatedAt",
    "status",
    "verifiedRevision",
    "currentRevision",
    "signals",
    "reasons",
  ],
  additionalProperties: false,
} as const;

export type KnowledgePromotionPolicy = FromSchema<typeof knowledgePromotionPolicySchema>;
export type KnowledgeReviewApproval = FromSchema<typeof knowledgeReviewApprovalSchema>;
export type VerifiedKnowledge = FromSchema<typeof verifiedKnowledgeSchema>;
export type KnowledgeStalenessResult = FromSchema<typeof knowledgeStalenessResultSchema>;
