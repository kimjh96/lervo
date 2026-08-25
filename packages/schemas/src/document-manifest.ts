import type { FromSchema } from "json-schema-to-ts";

import { documentIdSchema, localeSchema, schemaVersionSchema } from "./common.js";
import { documentRecordSchema } from "./document-registry.js";

const commonProperties = {
  mediaType: { const: "text/markdown; charset=utf-8" },
  profileId: {
    type: "string",
    pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$",
    maxLength: 150,
  },
  locale: localeSchema,
  audience: { type: "string", enum: ["human", "machine", "mixed"] },
  metadataPlacement: { const: "sidecar" },
  historyMode: { const: "separate_documents" },
  splitStrategy: { const: "topic_documents" },
} as const;

const commonRequired = [
  "mediaType",
  "profileId",
  "locale",
  "audience",
  "metadataPlacement",
  "historyMode",
  "splitStrategy",
] as const;

const userManagedContentPolicySchema = {
  type: "object",
  properties: {
    ...commonProperties,
    mode: { const: "user_managed" },
    automaticWrites: { const: false },
    splitRecommendedAtBytes: { const: 32768 },
    oversizeReviewAtBytes: { const: 65536 },
    overflowAction: { const: "report_split_recommended" },
  },
  required: [
    ...commonRequired,
    "mode",
    "automaticWrites",
    "splitRecommendedAtBytes",
    "oversizeReviewAtBytes",
    "overflowAction",
  ],
  additionalProperties: false,
} as const;

const managedBlocksContentPolicySchema = {
  type: "object",
  properties: {
    ...commonProperties,
    mode: { const: "managed_blocks" },
    writeScope: { const: "declared_blocks_only" },
    maxBlockBytes: { const: 8192 },
    overflowAction: { const: "split_and_link" },
  },
  required: [...commonRequired, "mode", "writeScope", "maxBlockBytes", "overflowAction"],
  additionalProperties: false,
} as const;

const lervoGeneratedContentPolicySchema = {
  type: "object",
  properties: {
    ...commonProperties,
    mode: { const: "lervo_generated" },
    writeScope: { const: "full_document_if_unmodified" },
    maxDocumentBytes: { const: 65536 },
    maxTopLevelSections: { const: 12 },
    overflowAction: { const: "split_and_link" },
  },
  required: [
    ...commonRequired,
    "mode",
    "writeScope",
    "maxDocumentBytes",
    "maxTopLevelSections",
    "overflowAction",
  ],
  additionalProperties: false,
} as const;

function ownershipCondition(mode: "user" | "managed_blocks" | "lervo_generated") {
  return {
    properties: {
      record: {
        type: "object",
        properties: {
          ownership: {
            type: "object",
            properties: { mode: { const: mode } },
            required: ["mode"],
          },
        },
        required: ["ownership"],
      },
    },
    required: ["record"],
  } as const;
}

export const documentManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/document-manifest.schema.json",
  title: "Lervo sharded document lifecycle manifest",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    documentId: documentIdSchema,
    record: documentRecordSchema,
    contentPolicy: {
      oneOf: [
        userManagedContentPolicySchema,
        managedBlocksContentPolicySchema,
        lervoGeneratedContentPolicySchema,
      ],
    },
    relations: {
      type: "object",
      properties: {
        parentDocumentId: documentIdSchema,
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
    },
  },
  required: ["schemaVersion", "documentId", "record", "contentPolicy", "relations"],
  allOf: [
    {
      if: ownershipCondition("user"),
      then: { properties: { contentPolicy: userManagedContentPolicySchema } },
    },
    {
      if: ownershipCondition("managed_blocks"),
      then: { properties: { contentPolicy: managedBlocksContentPolicySchema } },
    },
    {
      if: ownershipCondition("lervo_generated"),
      then: { properties: { contentPolicy: lervoGeneratedContentPolicySchema } },
    },
  ],
  additionalProperties: false,
} as const;

export type DocumentManifest = FromSchema<typeof documentManifestSchema>;
export type DocumentContentPolicy = DocumentManifest["contentPolicy"];
