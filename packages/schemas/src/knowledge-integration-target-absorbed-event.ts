import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";

const commitSchema = { type: "string", pattern: "^[0-9a-f]{40}$" } as const;

/**
 * ADR-0482 squash absorption. A squash merge brought the knowledge integration ref's content into
 * the base branch under other commits, so the convergence owner moved the Lervo-only ref to the
 * base after keeping the old tip under `refs/lervo/`. Paths stay in Git; the event carries commit
 * coordinates, counts, and one digest of the absorbed and dropped path sets.
 */
export const knowledgeIntegrationTargetAbsorbedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-integration-target-absorbed-event-payload.schema.json",
  type: "object",
  properties: {
    previousTarget: commitSchema,
    mergeBase: commitSchema,
    newTarget: commitSchema,
    absorbedPathCount: { type: "integer", minimum: 0 },
    droppedPathCount: { type: "integer", minimum: 0 },
    pathSetHash: sha256Schema,
    occurredAt: timestampSchema,
  },
  required: [
    "previousTarget",
    "mergeBase",
    "newTarget",
    "absorbedPathCount",
    "droppedPathCount",
    "pathSetHash",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export type KnowledgeIntegrationTargetAbsorbedEventPayload = FromSchema<
  typeof knowledgeIntegrationTargetAbsorbedEventPayloadSchema
>;
