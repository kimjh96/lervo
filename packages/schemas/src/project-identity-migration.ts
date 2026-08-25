import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";

export const projectIdentityMigratedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/project-identity-migrated-event-payload.schema.json",
  title: "Lervo project identity migration completion event payload",
  type: "object",
  properties: {
    planId: { type: "string", pattern: "^idm_[a-f0-9]{32}$" },
    sourceTreeHash: sha256Schema,
    preservedEventCount: { type: "integer", minimum: 0 },
    preservedEventHeadHash: { anyOf: [sha256Schema, { type: "null" }] },
    verifiedCasObjectCount: { type: "integer", minimum: 0, maximum: 100000 },
    documentDisposition: {
      type: "string",
      enum: ["create_empty", "preserve_active", "archive_previous_metadata"],
    },
    migratedAt: timestampSchema,
  },
  required: [
    "planId",
    "sourceTreeHash",
    "preservedEventCount",
    "preservedEventHeadHash",
    "verifiedCasObjectCount",
    "documentDisposition",
    "migratedAt",
  ],
  allOf: [
    {
      if: {
        properties: { preservedEventCount: { const: 0 } },
        required: ["preservedEventCount"],
      },
      then: { properties: { preservedEventHeadHash: { type: "null" } } },
      else: { properties: { preservedEventHeadHash: sha256Schema } },
    },
  ],
  additionalProperties: false,
} as const;

export type ProjectIdentityMigratedEventPayload = FromSchema<
  typeof projectIdentityMigratedEventPayloadSchema
>;
