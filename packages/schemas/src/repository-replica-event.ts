import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";

const replicaIdSchema = { type: "string", pattern: "^[a-z][a-z0-9_-]{1,63}$" } as const;

/**
 * One divergence identity observed under the `hold` policy (ADR-0456). Paths are published only
 * as digests; diagnostic text and SSH destinations never enter the event.
 */
export const repositoryReplicaDivergedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/repository-replica-diverged-event-payload.schema.json",
  type: "object",
  properties: {
    replicaId: replicaIdSchema,
    divergenceId: sha256Schema,
    localSnapshotHash: sha256Schema,
    peerSnapshotHash: sha256Schema,
    commonSnapshotHash: { anyOf: [sha256Schema, { type: "null" }] },
    conflictPathCount: { type: "integer", minimum: 0, maximum: 1_000_000 },
    conflictPathDigests: {
      type: "array",
      items: sha256Schema,
      maxItems: 16,
      uniqueItems: true,
    },
    occurredAt: timestampSchema,
  },
  required: [
    "replicaId",
    "divergenceId",
    "localSnapshotHash",
    "peerSnapshotHash",
    "commonSnapshotHash",
    "conflictPathCount",
    "conflictPathDigests",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export type RepositoryReplicaDivergedEventPayload = FromSchema<
  typeof repositoryReplicaDivergedEventPayloadSchema
>;

/** The single resolution of a previously recorded divergence identity. */
export const repositoryReplicaReconciledEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/repository-replica-reconciled-event-payload.schema.json",
  type: "object",
  properties: {
    divergenceId: sha256Schema,
    strategy: { type: "string", enum: ["prefer_local", "prefer_peer", "merge", "external"] },
    resultSnapshotHash: sha256Schema,
    occurredAt: timestampSchema,
  },
  required: ["divergenceId", "strategy", "resultSnapshotHash", "occurredAt"],
  additionalProperties: false,
} as const;

export type RepositoryReplicaReconciledEventPayload = FromSchema<
  typeof repositoryReplicaReconciledEventPayloadSchema
>;
