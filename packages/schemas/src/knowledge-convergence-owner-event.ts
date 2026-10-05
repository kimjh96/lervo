import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";

/**
 * ADR-0466 cross-host convergence ownership. Each host records the holder changes it observes in
 * its own event store. Hosts appear only as hashes of their private host identity; labels, Hub
 * addresses, and credentials never enter the event.
 */
export const knowledgeConvergenceOwnerChangedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-convergence-owner-changed-event-payload.schema.json",
  type: "object",
  properties: {
    repositoryIdentityHash: sha256Schema,
    holderHostHash: { anyOf: [sha256Schema, { type: "null" }] },
    previousHolderHostHash: { anyOf: [sha256Schema, { type: "null" }] },
    observerHostHash: sha256Schema,
    generation: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    mode: { type: "string", enum: ["hub", "standalone"] },
    reason: {
      type: "string",
      enum: ["lease", "expiry", "release", "delegation", "standalone"],
    },
    occurredAt: timestampSchema,
  },
  required: [
    "repositoryIdentityHash",
    "holderHostHash",
    "previousHolderHostHash",
    "observerHostHash",
    "generation",
    "mode",
    "reason",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export type KnowledgeConvergenceOwnerChangedEventPayload = FromSchema<
  typeof knowledgeConvergenceOwnerChangedEventPayloadSchema
>;
