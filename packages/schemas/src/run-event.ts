import type { FromSchema } from "json-schema-to-ts";

import { artifactIdSchema, sha256Schema } from "./common.js";

export const runCompletedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/run-completed-event-payload.schema.json",
  type: "object",
  properties: {
    resultDigest: sha256Schema,
    artifactIds: {
      type: "array",
      items: artifactIdSchema,
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
    },
    verificationStatus: {
      type: "string",
      enum: ["passed", "failed", "not_run"],
    },
  },
  required: ["resultDigest", "artifactIds", "verificationStatus"],
  additionalProperties: false,
} as const;

export type RunCompletedEventPayload = FromSchema<typeof runCompletedEventPayloadSchema>;
