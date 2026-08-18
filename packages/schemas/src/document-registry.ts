import type { FromSchema } from "json-schema-to-ts";

import {
  documentIdSchema,
  repositoryRelativePathSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";

const generatedInputSchema = {
  type: "object",
  properties: {
    sourceId: { type: "string", minLength: 1, maxLength: 200 },
    contentHash: sha256Schema,
  },
  required: ["sourceId", "contentHash"],
  additionalProperties: false,
} as const;

const userOwnershipSchema = {
  type: "object",
  properties: {
    mode: { const: "user" },
  },
  required: ["mode"],
  additionalProperties: false,
} as const;

const managedBlocksOwnershipSchema = {
  type: "object",
  properties: {
    mode: { const: "managed_blocks" },
    outsideManagedBlocks: { const: "preserve" },
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          blockId: {
            type: "string",
            pattern: "^[a-z][a-z0-9_-]*$",
            maxLength: 100,
          },
          startMarker: { type: "string", minLength: 1, maxLength: 300 },
          endMarker: { type: "string", minLength: 1, maxLength: 300 },
          inputs: {
            type: "array",
            items: generatedInputSchema,
            minItems: 1,
            uniqueItems: true,
          },
        },
        required: ["blockId", "startMarker", "endMarker", "inputs"],
        additionalProperties: false,
      },
      minItems: 1,
      uniqueItems: true,
    },
  },
  required: ["mode", "outsideManagedBlocks", "blocks"],
  additionalProperties: false,
} as const;

const rovenGeneratedOwnershipSchema = {
  type: "object",
  properties: {
    mode: { const: "roven_generated" },
    userContentAllowed: { const: false },
    manifestPath: repositoryRelativePathSchema,
    inputs: {
      type: "array",
      items: generatedInputSchema,
      minItems: 1,
      uniqueItems: true,
    },
  },
  required: ["mode", "userContentAllowed", "manifestPath", "inputs"],
  additionalProperties: false,
} as const;

export const documentRecordSchema = {
  type: "object",
  properties: {
    path: repositoryRelativePathSchema,
    kind: {
      type: "string",
      enum: ["canonical", "generated", "observed"],
    },
    responsibleParty: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["user", "team", "roven"] },
        id: { type: "string", minLength: 1, maxLength: 150 },
      },
      required: ["kind", "id"],
      additionalProperties: false,
    },
    connectedPaths: {
      type: "array",
      items: repositoryRelativePathSchema,
      minItems: 1,
      uniqueItems: true,
    },
    verifiedRevision: { type: "string", minLength: 1, maxLength: 200 },
    verifiedAt: timestampSchema,
    reviewIntervalDays: { type: "integer", minimum: 1 },
    ownership: {
      oneOf: [
        userOwnershipSchema,
        managedBlocksOwnershipSchema,
        rovenGeneratedOwnershipSchema,
      ],
    },
  },
  required: [
    "path",
    "kind",
    "responsibleParty",
    "connectedPaths",
    "verifiedRevision",
    "verifiedAt",
    "reviewIntervalDays",
    "ownership"
  ],
  allOf: [
    {
      if: {
        properties: { kind: { const: "observed" } },
        required: ["kind"],
      },
      then: {
        properties: { ownership: userOwnershipSchema },
      },
    },
    {
      if: {
        properties: { kind: { const: "canonical" } },
        required: ["kind"],
      },
      then: {
        properties: {
          ownership: {
            oneOf: [userOwnershipSchema, managedBlocksOwnershipSchema],
          },
        },
      },
    },
    {
      if: {
        properties: { kind: { const: "generated" } },
        required: ["kind"],
      },
      then: {
        properties: {
          ownership: {
            oneOf: [managedBlocksOwnershipSchema, rovenGeneratedOwnershipSchema],
          },
        },
      },
    },
  ],
  additionalProperties: false,
} as const;

export const documentRegistrySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.roven.dev/v0/document-registry.schema.json",
  title: "Roven document lifecycle registry",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    documents: {
      type: "object",
      propertyNames: documentIdSchema,
      additionalProperties: documentRecordSchema,
    },
  },
  required: ["schemaVersion", "documents"],
  additionalProperties: false,
} as const;

export type DocumentRegistry = FromSchema<typeof documentRegistrySchema>;
export type DocumentRecord = FromSchema<typeof documentRecordSchema>;
