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
import { migrationPlanIdSchema } from "./document-migration.js";

const reasonCodeSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,63}$",
} as const;

const approvalIdSchema = {
  type: "string",
  pattern: "^apr_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

const legacyApprovalCoordinatesSchema = {
  documentId: documentIdSchema,
  artifactId: artifactIdSchema,
  artifactHash: sha256Schema,
} as const;

const approveLegacySidecarDecisionMetadataSchema = {
  type: "object",
  properties: {
    ...legacyApprovalCoordinatesSchema,
    action: { const: "approve_sidecar" },
  },
  required: ["documentId", "artifactId", "artifactHash", "action"],
  additionalProperties: false,
} as const;

const approveLegacySidecarDecisionSchema = {
  ...approveLegacySidecarDecisionMetadataSchema,
  properties: {
    ...approveLegacySidecarDecisionMetadataSchema.properties,
    manifest: { $ref: documentManifestSchema.$id },
  },
  required: [...approveLegacySidecarDecisionMetadataSchema.required, "manifest"],
} as const;

const skipLegacyEntryDecisionSchema = {
  type: "object",
  properties: {
    ...legacyApprovalCoordinatesSchema,
    action: { const: "skip" },
    reasonCode: reasonCodeSchema,
  },
  required: [
    "documentId",
    "artifactId",
    "artifactHash",
    "action",
    "reasonCode",
  ],
  additionalProperties: false,
} as const;

export const legacyRegistryMigrationApprovalSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/legacy-registry-migration-approval.schema.json",
  title: "Lervo reviewed legacy document registry migration approval",
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
    decisions: {
      type: "array",
      items: {
        oneOf: [approveLegacySidecarDecisionSchema, skipLegacyEntryDecisionSchema],
      },
      maxItems: 4096,
    },
  },
  required: [
    "schemaVersion",
    "approvalId",
    "planId",
    "approvedAt",
    "approver",
    "decisions",
  ],
  additionalProperties: false,
} as const;

const appliedLegacySidecarSchema = {
  type: "object",
  properties: {
    documentId: documentIdSchema,
    contentHash: sha256Schema,
  },
  required: ["documentId", "contentHash"],
  additionalProperties: false,
} as const;

export const legacyRegistryMigrationAppliedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id:
    "https://schemas.lervo.dev/v0/legacy-registry-migration-applied-event-payload.schema.json",
  title: "Lervo legacy document registry migration applied event payload",
  type: "object",
  properties: {
    migrationKind: { const: "legacy_registry_structural" },
    planId: migrationPlanIdSchema,
    approvalId: approvalIdSchema,
    approvalDigest: sha256Schema,
    sourceRegistryHash: sha256Schema,
    entryArtifactHashes: {
      type: "array",
      items: sha256Schema,
      maxItems: 4096,
      uniqueItems: true,
    },
    archiveContentHash: sha256Schema,
    beforeLayoutHash: sha256Schema,
    afterLayoutHash: sha256Schema,
    sidecars: {
      type: "array",
      items: appliedLegacySidecarSchema,
      maxItems: 4096,
    },
    appliedAt: timestampSchema,
  },
  required: [
    "migrationKind",
    "planId",
    "approvalId",
    "approvalDigest",
    "sourceRegistryHash",
    "entryArtifactHashes",
    "archiveContentHash",
    "beforeLayoutHash",
    "afterLayoutHash",
    "sidecars",
    "appliedAt",
  ],
  additionalProperties: false,
} as const;

export const legacyRegistryMigrationApplyReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/legacy-registry-migration-apply-receipt.schema.json",
  title: "Lervo legacy document registry migration apply receipt",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    receiptId: { type: "string", pattern: "^lgar_[a-f0-9]{16}$" },
    planId: migrationPlanIdSchema,
    approvalId: approvalIdSchema,
    approvalDigest: sha256Schema,
    appliedAt: timestampSchema,
    archive: {
      type: "object",
      properties: {
        path: repositoryRelativePathSchema,
        contentHash: sha256Schema,
      },
      required: ["path", "contentHash"],
      additionalProperties: false,
    },
    deactivatedSource: {
      type: "object",
      properties: {
        path: { const: ".lervo/documents.yaml" },
        contentHash: sha256Schema,
        action: { const: "removed" },
      },
      required: ["path", "contentHash", "action"],
      additionalProperties: false,
    },
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
      maxItems: 4096,
    },
    skippedDocumentIds: {
      type: "array",
      items: documentIdSchema,
      maxItems: 4096,
      uniqueItems: true,
    },
    eventPayload: legacyRegistryMigrationAppliedEventPayloadSchema,
  },
  required: [
    "schemaVersion",
    "receiptId",
    "planId",
    "approvalId",
    "approvalDigest",
    "appliedAt",
    "archive",
    "deactivatedSource",
    "created",
    "skippedDocumentIds",
    "eventPayload",
  ],
  additionalProperties: false,
} as const;

type ApproveLegacySidecarDecisionMetadata = FromSchema<
  typeof approveLegacySidecarDecisionMetadataSchema
>;
type SkipLegacyEntryDecision = FromSchema<typeof skipLegacyEntryDecisionSchema>;
export type LegacyRegistryMigrationApprovalDecision =
  | (ApproveLegacySidecarDecisionMetadata & { manifest: DocumentManifest })
  | SkipLegacyEntryDecision;
export type LegacyRegistryMigrationApproval = Omit<
  FromSchema<typeof legacyRegistryMigrationApprovalSchema>,
  "decisions"
> & { decisions: LegacyRegistryMigrationApprovalDecision[] };
export type LegacyRegistryMigrationAppliedEventPayload = FromSchema<
  typeof legacyRegistryMigrationAppliedEventPayloadSchema
>;
export type LegacyRegistryMigrationApplyReceipt = FromSchema<
  typeof legacyRegistryMigrationApplyReceiptSchema
>;
