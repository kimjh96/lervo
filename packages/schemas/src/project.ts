import type { FromSchema } from "json-schema-to-ts";

import {
  projectIdSchema,
  schemaVersionSchema,
  timestampSchema,
} from "./common.js";

export const defaultProjectDataPolicy = {
  eventMetadataRetentionDays: 90,
  artifactRetentionDays: 30,
  persistRawPrompts: false,
  persistDocumentBodiesInEvents: false,
  hubSyncEnabled: false,
  eventPayloadMode: "allowlist",
} as const;

export const projectManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/project.schema.json",
  title: "Lervo project manifest",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    projectId: projectIdSchema,
    name: {
      type: "string",
      minLength: 1,
      maxLength: 100,
    },
    root: {
      type: "string",
      const: ".",
    },
    createdAt: timestampSchema,
    dataPolicy: {
      type: "object",
      properties: {
        eventMetadataRetentionDays: {
          type: "integer",
          minimum: 1,
          default: 90,
        },
        artifactRetentionDays: {
          type: "integer",
          minimum: 0,
          default: 30,
        },
        persistRawPrompts: {
          type: "boolean",
          default: false,
        },
        persistDocumentBodiesInEvents: {
          type: "boolean",
          default: false,
        },
        hubSyncEnabled: {
          type: "boolean",
          default: false,
        },
        eventPayloadMode: {
          type: "string",
          const: "allowlist",
        },
      },
      required: [
        "eventMetadataRetentionDays",
        "artifactRetentionDays",
        "persistRawPrompts",
        "persistDocumentBodiesInEvents",
        "hubSyncEnabled",
        "eventPayloadMode"
      ],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "projectId",
    "name",
    "root",
    "createdAt",
    "dataPolicy"
  ],
  additionalProperties: false,
} as const;

export type ProjectManifest = FromSchema<typeof projectManifestSchema>;
