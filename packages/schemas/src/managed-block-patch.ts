import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  blockIdSchema,
  repositoryRelativePathSchema,
  schemaVersionSchema,
  sha256Schema,
} from "./common.js";

export const managedBlockPatchCandidateIdSchema = {
  type: "string",
  pattern: "^mbpc_[a-f0-9]{16}$",
} as const;

const byteRangeSchema = {
  type: "object",
  properties: {
    start: { type: "integer", minimum: 0, maximum: 4194304 },
    end: { type: "integer", minimum: 0, maximum: 4194304 },
  },
  required: ["start", "end"],
  additionalProperties: false,
} as const;

export const managedBlockPatchCandidateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/managed-block-patch-candidate.schema.json",
  title: "Lervo managed block patch candidate",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    candidateId: managedBlockPatchCandidateIdSchema,
    disposition: { const: "review_required" },
    writesAllowed: { const: false },
    source: {
      type: "object",
      properties: {
        path: repositoryRelativePathSchema,
        contentHash: sha256Schema,
        byteCount: { type: "integer", minimum: 0, maximum: 4194304 },
      },
      required: ["path", "contentHash", "byteCount"],
      additionalProperties: false,
    },
    parser: {
      type: "object",
      properties: {
        parserId: { const: "lervo/commonmark-managed-blocks" },
        parserVersion: { const: "1.0.0" },
      },
      required: ["parserId", "parserVersion"],
      additionalProperties: false,
    },
    target: {
      type: "object",
      properties: {
        blockId: blockIdSchema,
        markerFamily: { const: "lervo_v1" },
        fullRange: byteRangeSchema,
        contentRange: byteRangeSchema,
        contentHash: sha256Schema,
      },
      required: ["blockId", "markerFamily", "fullRange", "contentRange", "contentHash"],
      additionalProperties: false,
    },
    replacement: {
      type: "object",
      properties: {
        contentHash: sha256Schema,
        byteCount: { type: "integer", minimum: 0, maximum: 8192 },
      },
      required: ["contentHash", "byteCount"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: {
        contentHash: sha256Schema,
        byteCount: { type: "integer", minimum: 0, maximum: 4194304 },
        contentRange: byteRangeSchema,
      },
      required: ["contentHash", "byteCount", "contentRange"],
      additionalProperties: false,
    },
    assurances: {
      type: "object",
      properties: {
        onlyTargetContentChanged: { const: true },
        markerBytesUnchanged: { const: true },
        outputStructureValid: { const: true },
      },
      required: ["onlyTargetContentChanged", "markerBytesUnchanged", "outputStructureValid"],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "candidateId",
    "disposition",
    "writesAllowed",
    "source",
    "parser",
    "target",
    "replacement",
    "output",
    "assurances",
  ],
  additionalProperties: false,
} as const;

export const managedBlockPatchCandidateArtifactSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/managed-block-patch-candidate-artifact.schema.json",
  title: "Lervo managed block patch candidate artifact",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    artifactId: artifactIdSchema,
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 1, maximum: 1048576 },
    candidate: managedBlockPatchCandidateSchema,
  },
  required: ["schemaVersion", "artifactId", "contentHash", "byteCount", "candidate"],
  additionalProperties: false,
} as const;

export type ManagedBlockPatchCandidate = FromSchema<typeof managedBlockPatchCandidateSchema>;
export type ManagedBlockPatchCandidateArtifact = FromSchema<
  typeof managedBlockPatchCandidateArtifactSchema
>;
