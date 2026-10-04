import type { FromSchema } from "json-schema-to-ts";

import { eventIdSchema, sha256Schema, timestampSchema } from "./common.js";

export const knowledgeConvergenceStages = [
  "assessment",
  "canonical_review",
  "canonical_integration",
  "normalization_generation",
  "normalization_review",
  "normalization_apply",
  "lifecycle_verification",
] as const;

export const knowledgeConvergenceStates = [
  "queued",
  "running",
  "waiting_review",
  "waiting_authority",
  "retry_scheduled",
  "stale",
  "recovery_required",
  "attention_required",
  "current",
  "superseded",
] as const;

const obligationId = { type: "string", pattern: "^kconv_[a-f0-9]{24}$" } as const;
const nullableHash = { anyOf: [sha256Schema, { type: "null" }] } as const;
const nullableId = { anyOf: [obligationId, { type: "null" }] } as const;
const failure = {
  anyOf: [{ type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" }, { type: "null" }],
} as const;
const debtCount = { type: "integer", minimum: 0, maximum: 1_000_000 } as const;

export const repositoryKnowledgeBaselineRequestedEventPayloadSchema = {
  type: "object",
  properties: {
    obligationId,
    sourceSnapshotId: { type: "string", minLength: 1, maxLength: 128 },
    sourceSnapshotHash: sha256Schema,
    policyHash: sha256Schema,
    debtDigest: sha256Schema,
    delegationHash: nullableHash,
    debtCounts: {
      type: "object",
      properties: {
        canonicalization: debtCount,
        normalization: debtCount,
        lifecycle: debtCount,
        historical: debtCount,
      },
      required: ["canonicalization", "normalization", "lifecycle", "historical"],
      additionalProperties: false,
    },
    inputArtifactHash: sha256Schema,
    requestedAt: timestampSchema,
  },
  required: [
    "obligationId",
    "sourceSnapshotId",
    "sourceSnapshotHash",
    "policyHash",
    "debtDigest",
    "delegationHash",
    "debtCounts",
    "inputArtifactHash",
    "requestedAt",
  ],
  additionalProperties: false,
} as const;

export const repositoryKnowledgeStageRecordedEventPayloadSchema = {
  type: "object",
  properties: {
    obligationId,
    predecessorEventId: eventIdSchema,
    predecessorEventHash: sha256Schema,
    stage: { type: "string", enum: knowledgeConvergenceStages },
    state: { type: "string", enum: knowledgeConvergenceStates },
    snapshotHash: sha256Schema,
    assignmentId: { anyOf: [{ type: "string", pattern: "^asn_[a-f0-9]{24}$" }, { type: "null" }] },
    leaseGeneration: nullableHash,
    attemptCount: { type: "integer", minimum: 0, maximum: 16 },
    inputArtifactHash: nullableHash,
    resultArtifactHash: nullableHash,
    nextObligationId: nullableId,
    dependencyHash: nullableHash,
    failureCode: failure,
    occurredAt: timestampSchema,
  },
  required: [
    "obligationId",
    "predecessorEventId",
    "predecessorEventHash",
    "stage",
    "state",
    "snapshotHash",
    "assignmentId",
    "leaseGeneration",
    "attemptCount",
    "inputArtifactHash",
    "resultArtifactHash",
    "nextObligationId",
    "dependencyHash",
    "failureCode",
    "occurredAt",
  ],
  allOf: [
    {
      if: {
        properties: {
          state: {
            enum: [
              "waiting_review",
              "waiting_authority",
              "attention_required",
              "recovery_required",
            ],
          },
        },
      },
      then: { properties: { dependencyHash: sha256Schema } },
    },
    {
      if: { properties: { state: { const: "current" } } },
      then: { properties: { resultArtifactHash: sha256Schema, failureCode: { type: "null" } } },
    },
  ],
  additionalProperties: false,
} as const;

export const repositoryKnowledgeConvergenceRecordedEventPayloadSchema = {
  type: "object",
  properties: {
    obligationId,
    originalEventId: eventIdSchema,
    originalEventHash: sha256Schema,
    scope: { type: "string", enum: ["change", "baseline"] },
    terminalState: { type: "string", enum: ["current", "superseded"] },
    snapshotHash: sha256Schema,
    canonicalDispositionDigest: sha256Schema,
    normalizationCoverageDigest: sha256Schema,
    lifecycleReceiptDigest: sha256Schema,
    knowledgeSnapshotHash: nullableHash,
    successorId: nullableId,
    failureCode: failure,
    resolvedAt: timestampSchema,
  },
  required: [
    "obligationId",
    "originalEventId",
    "originalEventHash",
    "scope",
    "terminalState",
    "snapshotHash",
    "canonicalDispositionDigest",
    "normalizationCoverageDigest",
    "lifecycleReceiptDigest",
    "knowledgeSnapshotHash",
    "successorId",
    "failureCode",
    "resolvedAt",
  ],
  allOf: [
    {
      if: { properties: { terminalState: { const: "current" } } },
      then: {
        properties: {
          knowledgeSnapshotHash: sha256Schema,
          successorId: { type: "null" },
          failureCode: { type: "null" },
        },
      },
    },
    {
      if: { properties: { terminalState: { const: "superseded" } } },
      then: { properties: { successorId: obligationId, knowledgeSnapshotHash: { type: "null" } } },
    },
  ],
  additionalProperties: false,
} as const;

export type RepositoryKnowledgeBaselineRequestedEventPayload = FromSchema<
  typeof repositoryKnowledgeBaselineRequestedEventPayloadSchema
>;
export type RepositoryKnowledgeStageRecordedEventPayload = FromSchema<
  typeof repositoryKnowledgeStageRecordedEventPayloadSchema
>;
export type RepositoryKnowledgeConvergenceRecordedEventPayload = FromSchema<
  typeof repositoryKnowledgeConvergenceRecordedEventPayloadSchema
>;
export type KnowledgeConvergenceStage = (typeof knowledgeConvergenceStages)[number];
export type KnowledgeConvergenceState = (typeof knowledgeConvergenceStates)[number];
