import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  documentIdSchema,
  repositoryRelativePathSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";
import {
  documentManifestSchema,
  type DocumentManifest,
} from "./document-manifest.js";
import {
  migrationCandidateIdSchema,
  migrationPlanIdSchema,
} from "./document-migration.js";

const approvalIdSchema = {
  type: "string",
  pattern: "^apr_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

const approvalDecisionCoordinates = {
  candidateId: migrationCandidateIdSchema,
  artifactId: artifactIdSchema,
  artifactHash: sha256Schema,
} as const;

const approveSidecarDecisionMetadataSchema = {
  type: "object",
  properties: {
    ...approvalDecisionCoordinates,
    action: { const: "approve_sidecar" },
  },
  required: ["candidateId", "artifactId", "artifactHash", "action"],
  additionalProperties: false,
} as const;

const approveSidecarDecisionSchema = {
  ...approveSidecarDecisionMetadataSchema,
  properties: {
    ...approveSidecarDecisionMetadataSchema.properties,
    manifest: { $ref: documentManifestSchema.$id },
  },
  required: [...approveSidecarDecisionMetadataSchema.required, "manifest"],
} as const;

const skipDecisionSchema = {
  type: "object",
  properties: {
    ...approvalDecisionCoordinates,
    action: { const: "skip" },
    reasonCode: {
      type: "string",
      pattern: "^[a-z][a-z0-9_]{0,63}$",
    },
  },
  required: ["candidateId", "artifactId", "artifactHash", "action", "reasonCode"],
  additionalProperties: false,
} as const;

const approvalMetadataSchema = {
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    approvalId: approvalIdSchema,
    planId: migrationPlanIdSchema,
    approvedAt: timestampSchema,
    approver: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["user", "policy"] },
        id: { type: "string", minLength: 1, maxLength: 150 },
      },
      required: ["kind", "id"],
      additionalProperties: false,
    },
  },
  required: ["schemaVersion", "approvalId", "planId", "approvedAt", "approver"],
  additionalProperties: false,
} as const;

export const documentMigrationApprovalSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.roven.dev/v0/document-migration-approval.schema.json",
  title: "Roven reviewed document migration approval",
  ...approvalMetadataSchema,
  properties: {
    ...approvalMetadataSchema.properties,
    decisions: {
      type: "array",
      items: { oneOf: [approveSidecarDecisionSchema, skipDecisionSchema] },
      minItems: 1,
      maxItems: 4096,
    },
  },
  required: [...approvalMetadataSchema.required, "decisions"],
} as const;

const appliedSidecarSchema = {
  type: "object",
  properties: {
    documentId: documentIdSchema,
    contentHash: sha256Schema,
  },
  required: ["documentId", "contentHash"],
  additionalProperties: false,
} as const;

export const documentMigrationAppliedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.roven.dev/v0/document-migration-applied-event-payload.schema.json",
  title: "Roven document migration applied event payload",
  type: "object",
  properties: {
    planId: migrationPlanIdSchema,
    approvalId: approvalIdSchema,
    approvalDigest: sha256Schema,
    beforeLayoutHash: sha256Schema,
    afterLayoutHash: sha256Schema,
    sourceHashes: {
      type: "array",
      items: sha256Schema,
      minItems: 1,
      maxItems: 4096,
      uniqueItems: true,
    },
    candidateArtifactHashes: {
      type: "array",
      items: sha256Schema,
      minItems: 1,
      maxItems: 4096,
      uniqueItems: true,
    },
    sidecars: {
      type: "array",
      items: appliedSidecarSchema,
      minItems: 1,
      maxItems: 4096,
    },
    appliedAt: timestampSchema,
  },
  required: [
    "planId",
    "approvalId",
    "approvalDigest",
    "beforeLayoutHash",
    "afterLayoutHash",
    "sourceHashes",
    "candidateArtifactHashes",
    "sidecars",
    "appliedAt",
  ],
  additionalProperties: false,
} as const;

export const documentMigrationApplyReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.roven.dev/v0/document-migration-apply-receipt.schema.json",
  title: "Roven document migration apply receipt",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    receiptId: {
      type: "string",
      pattern: "^mgar_[a-f0-9]{16}$",
    },
    planId: migrationPlanIdSchema,
    approvalId: approvalIdSchema,
    approvalDigest: sha256Schema,
    appliedAt: timestampSchema,
    created: {
      type: "array",
      items: {
        type: "object",
        properties: {
          documentId: documentIdSchema,
          path: repositoryRelativePathSchema,
          contentHash: sha256Schema,
        },
        required: ["documentId", "path", "contentHash"],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 4096,
    },
    skippedCandidateIds: {
      type: "array",
      items: migrationCandidateIdSchema,
      maxItems: 4096,
      uniqueItems: true,
    },
    eventPayload: documentMigrationAppliedEventPayloadSchema,
  },
  required: [
    "schemaVersion",
    "receiptId",
    "planId",
    "approvalId",
    "approvalDigest",
    "appliedAt",
    "created",
    "skippedCandidateIds",
    "eventPayload",
  ],
  additionalProperties: false,
} as const;

type ApprovalMetadata = FromSchema<typeof approvalMetadataSchema>;
type ApproveSidecarDecisionMetadata = FromSchema<
  typeof approveSidecarDecisionMetadataSchema
>;
type SkipDecision = FromSchema<typeof skipDecisionSchema>;

export type DocumentMigrationApprovalDecision =
  | (ApproveSidecarDecisionMetadata & { manifest: DocumentManifest })
  | SkipDecision;
export type DocumentMigrationApproval = ApprovalMetadata & {
  decisions: DocumentMigrationApprovalDecision[];
};
export type DocumentMigrationAppliedEventPayload = FromSchema<
  typeof documentMigrationAppliedEventPayloadSchema
>;
export type DocumentMigrationApplyReceipt = FromSchema<
  typeof documentMigrationApplyReceiptSchema
>;
