import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";

const classCountSchema = {
  type: "object",
  properties: {
    retentionClass: {
      type: "string",
      enum: ["rebuildable_cache", "completed_workspace", "bounded_observation"],
    },
    artifacts: { type: "integer", minimum: 0 },
    files: { type: "integer", minimum: 0 },
    bytes: { type: "integer", minimum: 0 },
  },
  required: ["retentionClass", "artifacts", "files", "bytes"],
  additionalProperties: false,
} as const;

export const statePrunedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/state-pruned-event-payload.schema.json",
  type: "object",
  properties: {
    planId: { type: "string", pattern: "^kstateprune_[a-f0-9]{24}$" },
    policyHash: sha256Schema,
    inventoryDigest: sha256Schema,
    removedFiles: { type: "integer", minimum: 0 },
    removedBytes: { type: "integer", minimum: 0 },
    classCounts: { type: "array", items: classCountSchema, maxItems: 3 },
    appliedAt: timestampSchema,
  },
  required: [
    "planId",
    "policyHash",
    "inventoryDigest",
    "removedFiles",
    "removedBytes",
    "classCounts",
    "appliedAt",
  ],
  additionalProperties: false,
} as const;

export type StatePrunedEventPayload = FromSchema<typeof statePrunedEventPayloadSchema>;
