import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";

/**
 * ADR-0463 document freshness lifecycle events. Payloads carry repository-relative paths, hashes,
 * counts, codes, and identifiers only; hunk text, claims, evidence bodies, explanations, and
 * before-bytes stay in CAS and the rebuildable candidate store. `usageObserved` is the provider's
 * total token count; event redaction treats any key containing "token" as sensitive.
 */
const candidateIdSchema = { type: "string", pattern: "^kfresh_[a-f0-9]{24}$" } as const;
const cycleIdSchema = { type: "string", pattern: "^kfcy_[a-f0-9]{24}$" } as const;
const hunkIdSchema = { type: "string", pattern: "^kfh_[a-f0-9]{16}$" } as const;
const relativePathSchema = {
  type: "string",
  minLength: 1,
  maxLength: 512,
  pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\u0000]+$",
} as const;
const countSchema = { type: "integer", minimum: 0, maximum: 1_000_000 } as const;
const changeClassSchema = {
  type: "string",
  enum: ["factual_reference", "statement", "safety_or_policy"],
} as const;
export const documentFreshnessFailureCodeSchema = {
  type: "string",
  enum: [
    "claim_unbound",
    "reference_unresolved",
    "outside_bytes_changed",
    "cross_check_disagreement",
    "source_changed",
    "freshness_budget_exhausted",
    "revert_conflict",
    "freshness_hold_active",
    "candidate_invalid",
    "owner_rejected",
    "write_failed",
  ],
} as const;
const checkCodeSchema = {
  type: "string",
  enum: [
    "source_hash",
    "outside_bytes_unchanged",
    "commonmark_structure",
    "references_resolve",
    "missing_references_resolved",
    "claims_bound",
    "edit_bound",
    "entrypoint_bounds",
    "writing_contract",
  ],
} as const;

export const documentFreshnessCandidateCreatedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/document-freshness-candidate-created-event-payload.schema.json",
  type: "object",
  properties: {
    candidateId: candidateIdSchema,
    findingDigest: sha256Schema,
    documentPath: relativePathSchema,
    documentHash: sha256Schema,
    operation: {
      type: "string",
      enum: ["edit", "archive", "no_change_needed", "needs_owner_input"],
    },
    priorityClass: { type: "string", enum: ["safety", "entrypoint", "canonical", "other"] },
    changeClasses: { type: "array", items: changeClassSchema, maxItems: 3, uniqueItems: true },
    hunkCount: countSchema,
    evidenceCount: countSchema,
    evidenceTruncated: { type: "boolean" },
    usageObserved: countSchema,
    occurredAt: timestampSchema,
  },
  required: [
    "candidateId",
    "findingDigest",
    "documentPath",
    "documentHash",
    "operation",
    "priorityClass",
    "changeClasses",
    "hunkCount",
    "evidenceCount",
    "evidenceTruncated",
    "usageObserved",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export const documentFreshnessCandidateVerifiedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/document-freshness-candidate-verified-event-payload.schema.json",
  type: "object",
  properties: {
    candidateId: candidateIdSchema,
    checks: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        properties: {
          code: checkCodeSchema,
          status: { type: "string", enum: ["passed", "failed"] },
        },
        required: ["code", "status"],
        additionalProperties: false,
      },
    },
    crossCheck: {
      type: "string",
      enum: ["not_required", "agreement", "material_disagreement", "unavailable"],
    },
    deliberationRunId: {
      anyOf: [{ type: "string", pattern: "^[a-z]{3,8}_[A-Za-z0-9_-]{8,96}$" }, { type: "null" }],
    },
    authorityRequired: { type: "string", enum: ["none", "principal_mandate", "owner"] },
    afterHash: { anyOf: [sha256Schema, { type: "null" }] },
    occurredAt: timestampSchema,
  },
  required: [
    "candidateId",
    "checks",
    "crossCheck",
    "deliberationRunId",
    "authorityRequired",
    "afterHash",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export const documentFreshnessCandidateAppliedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/document-freshness-candidate-applied-event-payload.schema.json",
  type: "object",
  properties: {
    candidateId: candidateIdSchema,
    documentPath: relativePathSchema,
    beforeHash: sha256Schema,
    afterHash: sha256Schema,
    appliedHunkCount: countSchema,
    pendingHunkCount: countSchema,
    approvalSource: { type: "string", enum: ["lervo_managed", "principal_mandate", "owner"] },
    approvalRef: sha256Schema,
    commitHash: { anyOf: [{ type: "string", pattern: "^[a-f0-9]{40,64}$" }, { type: "null" }] },
    occurredAt: timestampSchema,
  },
  required: [
    "candidateId",
    "documentPath",
    "beforeHash",
    "afterHash",
    "appliedHunkCount",
    "pendingHunkCount",
    "approvalSource",
    "approvalRef",
    "commitHash",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export const documentFreshnessCandidateRejectedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/document-freshness-candidate-rejected-event-payload.schema.json",
  type: "object",
  properties: {
    candidateId: candidateIdSchema,
    reasonCode: documentFreshnessFailureCodeSchema,
    rejectorKind: {
      type: "string",
      enum: ["deterministic", "cross_check", "proxy", "owner", "budget"],
    },
    contestedHunkIds: { type: "array", items: hunkIdSchema, maxItems: 16, uniqueItems: true },
    occurredAt: timestampSchema,
  },
  required: ["candidateId", "reasonCode", "rejectorKind", "contestedHunkIds", "occurredAt"],
  additionalProperties: false,
} as const;

export const documentFreshnessCandidateRevertedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/document-freshness-candidate-reverted-event-payload.schema.json",
  type: "object",
  properties: {
    candidateId: candidateIdSchema,
    documentPath: relativePathSchema,
    restoredHash: sha256Schema,
    revertedBy: { type: "string", enum: ["owner", "agent"] },
    holdUntil: timestampSchema,
    occurredAt: timestampSchema,
  },
  required: [
    "candidateId",
    "documentPath",
    "restoredHash",
    "revertedBy",
    "holdUntil",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export const documentFreshnessCycleCompletedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/document-freshness-cycle-completed-event-payload.schema.json",
  type: "object",
  properties: {
    cycleId: cycleIdSchema,
    findingCount: countSchema,
    admittedCount: countSchema,
    candidateCount: countSchema,
    verifiedCount: countSchema,
    appliedCount: countSchema,
    skippedForBudget: countSchema,
    skippedForHold: countSchema,
    usageObserved: countSchema,
    occurredAt: timestampSchema,
  },
  required: [
    "cycleId",
    "findingCount",
    "admittedCount",
    "candidateCount",
    "verifiedCount",
    "appliedCount",
    "skippedForBudget",
    "skippedForHold",
    "usageObserved",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export type DocumentFreshnessCandidateCreatedEventPayload = FromSchema<
  typeof documentFreshnessCandidateCreatedEventPayloadSchema
>;
export type DocumentFreshnessCandidateVerifiedEventPayload = FromSchema<
  typeof documentFreshnessCandidateVerifiedEventPayloadSchema
>;
export type DocumentFreshnessCandidateAppliedEventPayload = FromSchema<
  typeof documentFreshnessCandidateAppliedEventPayloadSchema
>;
export type DocumentFreshnessCandidateRejectedEventPayload = FromSchema<
  typeof documentFreshnessCandidateRejectedEventPayloadSchema
>;
export type DocumentFreshnessCandidateRevertedEventPayload = FromSchema<
  typeof documentFreshnessCandidateRevertedEventPayloadSchema
>;
export type DocumentFreshnessCycleCompletedEventPayload = FromSchema<
  typeof documentFreshnessCycleCompletedEventPayloadSchema
>;

export const documentFreshnessEventTypes = [
  "document.freshness.candidate.created",
  "document.freshness.candidate.verified",
  "document.freshness.candidate.applied",
  "document.freshness.candidate.rejected",
  "document.freshness.candidate.reverted",
  "document.freshness.cycle.completed",
] as const;
