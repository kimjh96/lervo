import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  documentIdSchema,
  repositoryRelativePathSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";

export const migrationCandidateIdSchema = {
  type: "string",
  pattern: "^migc_[a-f0-9]{16}$",
} as const;

export const migrationPlanIdSchema = {
  type: "string",
  pattern: "^migp_[a-f0-9]{16}$",
} as const;

const warningCodeSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,63}$",
} as const;

const sourceSnapshotSchema = {
  type: "object",
  properties: {
    path: repositoryRelativePathSchema,
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 0, maximum: 4194304 },
  },
  required: ["path", "contentHash", "byteCount"],
  additionalProperties: false,
} as const;

const proposedRelationsSchema = {
  type: "object",
  properties: {
    supersedesDocumentIds: {
      type: "array",
      items: documentIdSchema,
      maxItems: 64,
      uniqueItems: true,
    },
    relatedDocumentIds: {
      type: "array",
      items: documentIdSchema,
      maxItems: 64,
      uniqueItems: true,
    },
  },
  required: ["supersedesDocumentIds", "relatedDocumentIds"],
  additionalProperties: false,
} as const;

const documentProposalSchema = {
  type: "object",
  properties: {
    documentId: documentIdSchema,
    documentPath: repositoryRelativePathSchema,
    profileId: {
      type: "string",
      pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$",
      maxLength: 150,
    },
    relations: proposedRelationsSchema,
  },
  required: ["documentId", "documentPath", "profileId", "relations"],
  additionalProperties: false,
} as const;

export const documentMigrationCandidateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.roven.dev/v0/document-migration-candidate.schema.json",
  title: "Roven document migration candidate",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    candidateId: migrationCandidateIdSchema,
    importer: {
      type: "object",
      properties: {
        adapterId: {
          type: "string",
          pattern: "^[a-z][a-z0-9_]{0,63}$",
        },
        version: {
          type: "string",
          pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
        },
      },
      required: ["adapterId", "version"],
      additionalProperties: false,
    },
    source: {
      type: "object",
      properties: {
        ...sourceSnapshotSchema.properties,
        formatId: {
          type: "string",
          pattern: "^[a-z][a-z0-9_-]{0,63}$",
        },
        locator: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["path", "contentHash", "byteCount", "formatId"],
      additionalProperties: false,
    },
    disposition: {
      type: "string",
      enum: ["ready_for_approval", "review_required", "observed"],
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low", "none"],
    },
    detectedOwnership: {
      type: "string",
      enum: ["user", "managed_blocks", "roven_generated", "unknown"],
    },
    proposal: {
      oneOf: [{ type: "null" }, documentProposalSchema],
    },
    warnings: {
      type: "array",
      items: warningCodeSchema,
      maxItems: 64,
      uniqueItems: true,
    },
  },
  required: [
    "schemaVersion",
    "candidateId",
    "importer",
    "source",
    "disposition",
    "confidence",
    "detectedOwnership",
    "proposal",
    "warnings",
  ],
  allOf: [
    {
      if: {
        properties: { proposal: { type: "null" } },
        required: ["proposal"],
      },
      then: {
        properties: {
          disposition: { const: "observed" },
          detectedOwnership: { const: "unknown" },
        },
      },
    },
    {
      if: {
        properties: { disposition: { const: "ready_for_approval" } },
        required: ["disposition"],
      },
      then: {
        properties: {
          proposal: documentProposalSchema,
          confidence: { enum: ["high", "medium"] },
        },
      },
    },
  ],
  additionalProperties: false,
} as const;

export const documentMigrationCandidateArtifactSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.roven.dev/v0/document-migration-candidate-artifact.schema.json",
  title: "Roven document migration candidate artifact",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    artifactId: artifactIdSchema,
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 1, maximum: 1048576 },
    candidate: documentMigrationCandidateSchema,
  },
  required: ["schemaVersion", "artifactId", "contentHash", "byteCount", "candidate"],
  additionalProperties: false,
} as const;

const missingTargetSchema = {
  type: "object",
  properties: { kind: { const: "missing" } },
  required: ["kind"],
  additionalProperties: false,
} as const;

const existingTargetSchema = {
  type: "object",
  properties: {
    kind: { const: "file" },
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 0, maximum: 65536 },
  },
  required: ["kind", "contentHash", "byteCount"],
  additionalProperties: false,
} as const;

const unsafeTargetSchema = {
  type: "object",
  properties: {
    kind: { const: "unsafe" },
    reasonCode: warningCodeSchema,
  },
  required: ["kind", "reasonCode"],
  additionalProperties: false,
} as const;

const planCandidateSchema = {
  type: "object",
  properties: {
    candidateId: migrationCandidateIdSchema,
    artifactId: artifactIdSchema,
    artifactHash: sha256Schema,
    sourcePath: repositoryRelativePathSchema,
    sourceHash: sha256Schema,
    action: {
      type: "string",
      enum: ["create_sidecar", "observe_only"],
    },
    target: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            path: repositoryRelativePathSchema,
            expected: {
              oneOf: [missingTargetSchema, existingTargetSchema, unsafeTargetSchema],
            },
          },
          required: ["path", "expected"],
          additionalProperties: false,
        },
      ],
    },
  },
  required: [
    "candidateId",
    "artifactId",
    "artifactHash",
    "sourcePath",
    "sourceHash",
    "action",
    "target",
  ],
  allOf: [
    {
      if: {
        properties: { action: { const: "observe_only" } },
        required: ["action"],
      },
      then: { properties: { target: { type: "null" } } },
      else: { properties: { target: { type: "object" } } },
    },
  ],
  additionalProperties: false,
} as const;

export const documentMigrationPlanSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.roven.dev/v0/document-migration-plan.schema.json",
  title: "Roven document migration dry-run plan",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    planId: migrationPlanIdSchema,
    generatedAt: timestampSchema,
    mode: { const: "dry_run" },
    writesAllowed: { const: false },
    approvalStatus: { const: "not_requested" },
    outcome: {
      type: "string",
      enum: ["ready_for_review", "review_required", "conflict"],
    },
    sources: {
      type: "array",
      items: sourceSnapshotSchema,
      maxItems: 4096,
    },
    candidates: {
      type: "array",
      items: planCandidateSchema,
      maxItems: 4096,
    },
    warnings: {
      type: "array",
      items: warningCodeSchema,
      maxItems: 256,
      uniqueItems: true,
    },
  },
  required: [
    "schemaVersion",
    "planId",
    "generatedAt",
    "mode",
    "writesAllowed",
    "approvalStatus",
    "outcome",
    "sources",
    "candidates",
    "warnings",
  ],
  additionalProperties: false,
} as const;

export type DocumentMigrationCandidate = FromSchema<
  typeof documentMigrationCandidateSchema
>;
export type DocumentMigrationCandidateArtifact = FromSchema<
  typeof documentMigrationCandidateArtifactSchema
>;
export type DocumentMigrationPlan = FromSchema<typeof documentMigrationPlanSchema>;
