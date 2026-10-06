import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";

const commitSchema = { type: "string", pattern: "^[0-9a-f]{40}$" } as const;

/**
 * ADR-0471 knowledge publication repair. The convergence owner records each corrective commit
 * that restored tool-owned or out-of-scope paths changed by `Lervo Knowledge` commits. Paths,
 * contents, and host labels stay in Git and host-local state; the event carries commit
 * coordinates, counts, and one digest of the restored path set.
 */
export const knowledgePublicationRepairedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-publication-repaired-event-payload.schema.json",
  type: "object",
  properties: {
    repairCommit: commitSchema,
    repairedCommits: { type: "array", items: commitSchema, minItems: 1, maxItems: 64 },
    toolGeneratedPathCount: { type: "integer", minimum: 0 },
    outsideScopePathCount: { type: "integer", minimum: 0 },
    normalizationPathCount: { type: "integer", minimum: 0 },
    pathSetHash: sha256Schema,
    hostHash: { anyOf: [sha256Schema, { type: "null" }] },
    occurredAt: timestampSchema,
  },
  required: [
    "repairCommit",
    "repairedCommits",
    "toolGeneratedPathCount",
    "outsideScopePathCount",
    "normalizationPathCount",
    "pathSetHash",
    "hostHash",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export type KnowledgePublicationRepairedEventPayload = FromSchema<
  typeof knowledgePublicationRepairedEventPayloadSchema
>;
