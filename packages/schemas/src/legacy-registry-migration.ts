import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  documentIdSchema,
  repositoryRelativePathSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";
import { documentRecordSchema } from "./document-registry.js";
import { migrationPlanIdSchema } from "./document-migration.js";

const warningCodeSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,63}$",
} as const;

const missingSnapshotSchema = {
  type: "object",
  properties: { kind: { const: "missing" } },
  required: ["kind"],
  additionalProperties: false,
} as const;

const fileSnapshotSchema = {
  type: "object",
  properties: {
    kind: { const: "file" },
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 0, maximum: 4194304 },
  },
  required: ["kind", "contentHash", "byteCount"],
  additionalProperties: false,
} as const;

const unsafeSnapshotSchema = {
  type: "object",
  properties: {
    kind: { const: "unsafe" },
    reasonCode: warningCodeSchema,
  },
  required: ["kind", "reasonCode"],
  additionalProperties: false,
} as const;

const pathSnapshotSchema = {
  oneOf: [missingSnapshotSchema, fileSnapshotSchema, unsafeSnapshotSchema],
} as const;

export const legacyRegistryEntryArtifactSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/legacy-registry-entry-artifact.schema.json",
  title: "Lervo legacy document registry entry artifact",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    artifactId: artifactIdSchema,
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 1, maximum: 1048576 },
    sourceRegistryHash: sha256Schema,
    documentId: documentIdSchema,
    record: documentRecordSchema,
  },
  required: [
    "schemaVersion",
    "artifactId",
    "contentHash",
    "byteCount",
    "sourceRegistryHash",
    "documentId",
    "record",
  ],
  additionalProperties: false,
} as const;

const planEntrySchema = {
  type: "object",
  properties: {
    documentId: documentIdSchema,
    artifactId: artifactIdSchema,
    artifactHash: sha256Schema,
    target: {
      type: "object",
      properties: {
        path: repositoryRelativePathSchema,
        expected: pathSnapshotSchema,
      },
      required: ["path", "expected"],
      additionalProperties: false,
    },
  },
  required: ["documentId", "artifactId", "artifactHash", "target"],
  additionalProperties: false,
} as const;

const referencedDocumentSchema = {
  type: "object",
  properties: {
    documentId: documentIdSchema,
    path: repositoryRelativePathSchema,
    snapshot: pathSnapshotSchema,
  },
  required: ["documentId", "path", "snapshot"],
  additionalProperties: false,
} as const;

export const legacyRegistryMigrationPlanSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/legacy-registry-migration-plan.schema.json",
  title: "Lervo legacy document registry structural migration dry-run plan",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    planId: migrationPlanIdSchema,
    generatedAt: timestampSchema,
    mode: { const: "legacy_registry_structural_dry_run" },
    writesAllowed: { const: false },
    approvalStatus: { const: "not_requested" },
    outcome: {
      type: "string",
      enum: ["ready_for_review", "review_required", "conflict"],
    },
    source: {
      type: "object",
      properties: {
        path: { const: ".lervo/documents.yaml" },
        contentHash: sha256Schema,
        byteCount: { type: "integer", minimum: 1, maximum: 4194304 },
        deactivationAction: { const: "archive_then_remove" },
      },
      required: ["path", "contentHash", "byteCount", "deactivationAction"],
      additionalProperties: false,
    },
    archiveTarget: {
      type: "object",
      properties: {
        path: repositoryRelativePathSchema,
        expected: pathSnapshotSchema,
      },
      required: ["path", "expected"],
      additionalProperties: false,
    },
    manifestDirectory: {
      type: "object",
      properties: {
        path: { const: ".lervo/documents" },
        expected: pathSnapshotSchema,
      },
      required: ["path", "expected"],
      additionalProperties: false,
    },
    referencedDocuments: {
      type: "array",
      items: referencedDocumentSchema,
      maxItems: 4096,
    },
    entries: {
      type: "array",
      items: planEntrySchema,
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
    "source",
    "archiveTarget",
    "manifestDirectory",
    "referencedDocuments",
    "entries",
    "warnings",
  ],
  additionalProperties: false,
} as const;

export type LegacyRegistryEntryArtifact = FromSchema<
  typeof legacyRegistryEntryArtifactSchema
>;
export type LegacyRegistryMigrationPlan = FromSchema<
  typeof legacyRegistryMigrationPlanSchema
>;
