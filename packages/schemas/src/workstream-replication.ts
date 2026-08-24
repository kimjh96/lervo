import type { FromSchema } from "json-schema-to-ts";

import { projectIdSchema, sha256Schema, timestampSchema } from "./common.js";
import { workstreamSnapshotSchema } from "./workstream.js";

const registrationIdSchema = { type: "string", pattern: "^hpr_[a-f0-9]{64}$" } as const;
const { $id: _workstreamId, $schema: _workstreamMeta, ...embeddedWorkstreamSnapshotSchema } = workstreamSnapshotSchema;

export const workstreamReplicationPublishRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/workstream-replication-publish-request.schema.json",
  type: "object",
  properties: {
    schemaVersion: { const: 1 },
    registrationId: registrationIdSchema,
    projectId: projectIdSchema,
    repositoryIdentityHash: sha256Schema,
    snapshotContentHash: sha256Schema,
    previousSnapshotContentHash: { anyOf: [sha256Schema, { type: "null" }] },
    snapshot: embeddedWorkstreamSnapshotSchema,
  },
  required: ["schemaVersion", "registrationId", "projectId", "repositoryIdentityHash", "snapshotContentHash", "previousSnapshotContentHash", "snapshot"],
  additionalProperties: false,
} as const;

const replicatedWorkstreamHeadSchema = {
  type: "object",
  properties: {
    workstreamId: { type: "string", pattern: "^wks_[a-f0-9]{24}$" },
    revision: { type: "integer", minimum: 1 },
    status: { type: "string", enum: ["active", "blocked", "completed"] },
    snapshotContentHash: sha256Schema,
    previousSnapshotContentHash: { anyOf: [sha256Schema, { type: "null" }] },
    publishedAt: timestampSchema,
  },
  required: ["workstreamId", "revision", "status", "snapshotContentHash", "previousSnapshotContentHash", "publishedAt"],
  additionalProperties: false,
} as const;

export const workstreamReplicationPublishResponseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/workstream-replication-publish-response.schema.json",
  type: "object",
  properties: {
    schemaVersion: { const: 1 },
    status: { type: "string", enum: ["created", "fast_forwarded", "duplicate", "divergent"] },
    projectId: projectIdSchema,
    repositoryIdentityHash: sha256Schema,
    heads: { type: "array", items: replicatedWorkstreamHeadSchema, minItems: 1, maxItems: 16 },
  },
  required: ["schemaVersion", "status", "projectId", "repositoryIdentityHash", "heads"],
  additionalProperties: false,
} as const;

export const workstreamReplicationReadResponseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/workstream-replication-read-response.schema.json",
  type: "object",
  properties: {
    schemaVersion: { const: 1 },
    status: { type: "string", enum: ["not_found", "current", "divergent"] },
    projectId: projectIdSchema,
    repositoryIdentityHash: sha256Schema,
    heads: { type: "array", items: replicatedWorkstreamHeadSchema, maxItems: 16 },
    snapshot: { anyOf: [embeddedWorkstreamSnapshotSchema, { type: "null" }] },
  },
  required: ["schemaVersion", "status", "projectId", "repositoryIdentityHash", "heads", "snapshot"],
  additionalProperties: false,
  allOf: [
    {
      if: { properties: { status: { const: "not_found" } }, required: ["status"] },
      then: { properties: { heads: { type: "array", maxItems: 0 }, snapshot: { type: "null" } } },
    },
    {
      if: { properties: { status: { const: "current" } }, required: ["status"] },
      then: { properties: { heads: { type: "array", minItems: 1, maxItems: 1 }, snapshot: embeddedWorkstreamSnapshotSchema } },
    },
    {
      if: { properties: { status: { const: "divergent" } }, required: ["status"] },
      then: { properties: { heads: { type: "array", minItems: 2 }, snapshot: { type: "null" } } },
    },
  ],
} as const;

export type WorkstreamReplicationPublishRequest = FromSchema<typeof workstreamReplicationPublishRequestSchema>;
export type WorkstreamReplicationPublishResponse = FromSchema<typeof workstreamReplicationPublishResponseSchema>;
export type WorkstreamReplicationReadResponse = FromSchema<typeof workstreamReplicationReadResponseSchema>;
export type ReplicatedWorkstreamHead = FromSchema<typeof replicatedWorkstreamHeadSchema>;
