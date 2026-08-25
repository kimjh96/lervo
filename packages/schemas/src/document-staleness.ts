import type { FromSchema } from "json-schema-to-ts";

import {
  documentIdSchema,
  repositoryRelativePathSchema,
  schemaVersionSchema,
  timestampSchema,
} from "./common.js";

export const documentStalenessResultIdSchema = {
  type: "string",
  pattern: "^dst_[a-f0-9]{16}$",
} as const;

const signalStatusSchema = {
  type: "string",
  enum: ["current", "stale", "unknown"],
} as const;

const sourceIdSchema = {
  type: "string",
  minLength: 1,
  maxLength: 200,
} as const;

const pathListSchema = {
  type: "array",
  items: repositoryRelativePathSchema,
  maxItems: 40000,
  uniqueItems: true,
} as const;

const sourceIdListSchema = {
  type: "array",
  items: sourceIdSchema,
  maxItems: 4096,
  uniqueItems: true,
} as const;

export const documentStalenessResultSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/document-staleness-result.schema.json",
  title: "Lervo document staleness result",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    resultId: documentStalenessResultIdSchema,
    documentId: documentIdSchema,
    evaluatedAt: timestampSchema,
    status: { type: "string", enum: ["current", "stale", "unknown"] },
    verifiedRevision: { type: "string", minLength: 1, maxLength: 200 },
    currentRevision: { type: "string", minLength: 1, maxLength: 200 },
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
        documentPath: {
          type: "object",
          properties: { status: signalStatusSchema },
          required: ["status"],
          additionalProperties: false,
        },
        connectedPaths: {
          type: "object",
          properties: {
            status: signalStatusSchema,
            changedPaths: pathListSchema,
            unobservedPaths: pathListSchema,
          },
          required: ["status", "changedPaths", "unobservedPaths"],
          additionalProperties: false,
        },
        managedInputs: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["not_applicable", "current", "stale", "unknown"],
            },
            changedSourceIds: sourceIdListSchema,
            missingSourceIds: sourceIdListSchema,
            unobservedSourceIds: sourceIdListSchema,
          },
          required: ["status", "changedSourceIds", "missingSourceIds", "unobservedSourceIds"],
          additionalProperties: false,
        },
      },
      required: ["reviewInterval", "documentPath", "connectedPaths", "managedInputs"],
      additionalProperties: false,
    },
    reasons: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "connected_path_changed",
          "connected_path_unobserved",
          "document_path_changed",
          "document_path_missing",
          "document_path_unobserved",
          "managed_input_changed",
          "managed_input_missing",
          "managed_input_unobserved",
          "review_interval_elapsed",
          "verified_snapshot_mismatch",
          "verified_snapshot_unavailable",
        ],
      },
      maxItems: 10,
      uniqueItems: true,
    },
  },
  required: [
    "schemaVersion",
    "resultId",
    "documentId",
    "evaluatedAt",
    "status",
    "verifiedRevision",
    "currentRevision",
    "signals",
    "reasons",
  ],
  additionalProperties: false,
} as const;

export type DocumentStalenessResult = FromSchema<typeof documentStalenessResultSchema>;
export type DocumentStalenessReason = DocumentStalenessResult["reasons"][number];
