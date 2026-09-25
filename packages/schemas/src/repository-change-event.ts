import type { FromSchema } from "json-schema-to-ts";

import {
  eventIdSchema,
  repositoryRelativePathSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";

/** One observed repository change unit from any entry point; the durable knowledge-job source. */
export const repositoryChangeCompletedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/repository-change-completed-event-payload.schema.json",
  type: "object",
  properties: {
    sourceKind: { type: "string", enum: ["conversation", "managed_run", "terminal_turn"] },
    sourceEventId: eventIdSchema,
    repositoryRevisionBefore: sha256Schema,
    repositoryRevisionAfter: sha256Schema,
    changedPathCount: { type: "integer", minimum: 1, maximum: 1_000_000 },
    changedPaths: {
      type: "array",
      items: repositoryRelativePathSchema,
      maxItems: 64,
      uniqueItems: true,
    },
    sourceManifest: {
      type: "object",
      properties: {
        contentHash: sha256Schema,
        byteCount: { type: "integer", minimum: 1, maximum: 1_048_576 },
      },
      required: ["contentHash", "byteCount"],
      additionalProperties: false,
    },
    occurredAt: timestampSchema,
  },
  required: [
    "sourceKind",
    "sourceEventId",
    "repositoryRevisionBefore",
    "repositoryRevisionAfter",
    "changedPathCount",
    "changedPaths",
    "sourceManifest",
    "occurredAt",
  ],
  // Beyond the path bound only the count is published; the manifest keeps every path and the
  // worker settles the unit as attention_required, never as a truncated success.
  if: { properties: { changedPathCount: { type: "integer", maximum: 64 } } },
  then: { properties: { changedPaths: { type: "array", minItems: 1 } } },
  else: { properties: { changedPaths: { type: "array", maxItems: 0 } } },
  additionalProperties: false,
} as const;

export type RepositoryChangeCompletedEventPayload = FromSchema<
  typeof repositoryChangeCompletedEventPayloadSchema
>;
