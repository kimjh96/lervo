import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  repositoryRelativePathSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";

const workstreamIdSchema = {
  type: "string",
  pattern: "^wks_[a-f0-9]{24}$",
} as const;

export const workstreamSnapshotSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/workstream-snapshot.schema.json",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    workstreamId: workstreamIdSchema,
    revision: { type: "integer", minimum: 1 },
    status: { type: "string", enum: ["active", "blocked", "completed", "cancelled"] },
    title: { type: "string", minLength: 1, maxLength: 200 },
    objective: { type: "string", minLength: 1, maxLength: 8192 },
    nextActions: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 1024 },
      maxItems: 32,
    },
    blockers: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 1024 },
      maxItems: 16,
    },
    notes: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 2048 },
      maxItems: 32,
    },
    references: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { ...repositoryRelativePathSchema, maxLength: 500 },
          label: { type: "string", minLength: 1, maxLength: 200 },
        },
        required: ["path", "label"],
        additionalProperties: false,
      },
      maxItems: 32,
    },
    pendingDecisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          decisionId: { type: "string", pattern: "^wdec_[a-f0-9]{16}$" },
          question: { type: "string", minLength: 1, maxLength: 1024 },
          choices: {
            type: "array",
            items: {
              type: "object",
              properties: {
                choiceId: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" },
                label: { type: "string", minLength: 1, maxLength: 200 },
                consequence: { type: "string", minLength: 1, maxLength: 1024 },
              },
              required: ["choiceId", "label", "consequence"],
              additionalProperties: false,
            },
            minItems: 2,
            maxItems: 8,
          },
          recommendedChoiceId: {
            anyOf: [{ type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" }, { type: "null" }],
          },
          blocking: { type: "boolean" },
        },
        required: ["decisionId", "question", "choices", "recommendedChoiceId", "blocking"],
        additionalProperties: false,
      },
      maxItems: 8,
    },
    pendingApprovals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          approvalId: { type: "string", pattern: "^wapr_[a-f0-9]{16}$" },
          kind: {
            type: "string",
            enum: ["repository_bytes", "managed_write", "external_action", "deployment"],
          },
          summary: { type: "string", minLength: 1, maxLength: 1024 },
          bindingHash: sha256Schema,
          blocking: { type: "boolean" },
        },
        required: ["approvalId", "kind", "summary", "bindingHash", "blocking"],
        additionalProperties: false,
      },
      maxItems: 8,
    },
    origin: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["legacy_handoff", "legacy_continuation", "created", "successor"],
        },
        sourceArtifactId: { anyOf: [artifactIdSchema, { type: "null" }] },
        sourceContentHash: { anyOf: [sha256Schema, { type: "null" }] },
        sourcePathDigest: { anyOf: [sha256Schema, { type: "null" }] },
        predecessorWorkstreamId: workstreamIdSchema,
        predecessorSnapshotContentHash: sha256Schema,
        reconciliationPredecessors: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          uniqueItems: true,
          items: {
            type: "object",
            properties: {
              workstreamId: workstreamIdSchema,
              snapshotContentHash: sha256Schema,
            },
            required: ["workstreamId", "snapshotContentHash"],
            additionalProperties: false,
          },
        },
      },
      required: ["kind", "sourceArtifactId", "sourceContentHash", "sourcePathDigest"],
      additionalProperties: false,
      if: { properties: { kind: { const: "successor" } }, required: ["kind"] },
      then: {
        required: ["predecessorWorkstreamId", "predecessorSnapshotContentHash"],
        properties: {
          predecessorWorkstreamId: workstreamIdSchema,
          predecessorSnapshotContentHash: sha256Schema,
          sourceArtifactId: { type: "null" },
          sourceContentHash: { type: "null" },
          sourcePathDigest: { type: "null" },
        },
      },
      else: {
        properties: {
          predecessorWorkstreamId: false,
          predecessorSnapshotContentHash: false,
          reconciliationPredecessors: false,
        },
      },
    },
    updatedAt: timestampSchema,
    /** Server-observed repository HEAD at write time; absent on snapshots that predate it. */
    repositoryHead: {
      type: "object",
      properties: {
        commit: { type: "string", pattern: "^[a-f0-9]{40,64}$" },
        observedAt: timestampSchema,
      },
      required: ["commit", "observedAt"],
      additionalProperties: false,
    },
    /** Cumulative count of oldest notes dropped by rolling note retention. */
    droppedNoteCount: { type: "integer", minimum: 0 },
  },
  required: [
    "schemaVersion",
    "workstreamId",
    "revision",
    "status",
    "title",
    "objective",
    "nextActions",
    "blockers",
    "notes",
    "references",
    "origin",
    "updatedAt",
  ],
  additionalProperties: false,
} as const;

export const workstreamSnapshotRecordedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/workstream-snapshot-recorded-event-payload.schema.json",
  type: "object",
  properties: {
    workstreamId: workstreamIdSchema,
    revision: { type: "integer", minimum: 1 },
    status: { type: "string", enum: ["active", "blocked", "completed", "cancelled"] },
    changeKind: {
      type: "string",
      enum: [
        "legacy_handoff_migration",
        "legacy_continuation_migration",
        "user_start",
        "user_update",
        "agent_start",
        "agent_update",
        "hub_replication_import",
      ],
    },
    snapshotArtifactId: artifactIdSchema,
    snapshotContentHash: sha256Schema,
    previousSnapshotContentHash: { anyOf: [sha256Schema, { type: "null" }] },
    sourceArtifactId: { anyOf: [artifactIdSchema, { type: "null" }] },
    sourceContentHash: { anyOf: [sha256Schema, { type: "null" }] },
    recordedAt: timestampSchema,
  },
  required: [
    "workstreamId",
    "revision",
    "status",
    "changeKind",
    "snapshotArtifactId",
    "snapshotContentHash",
    "previousSnapshotContentHash",
    "sourceArtifactId",
    "sourceContentHash",
    "recordedAt",
  ],
  additionalProperties: false,
} as const;

export type WorkstreamSnapshot = FromSchema<typeof workstreamSnapshotSchema>;
export function hasWorkstreamPredecessor(
  snapshot: WorkstreamSnapshot,
  predecessor: WorkstreamSnapshot & { snapshotContentHash: string },
): boolean {
  const parents = workstreamReconciliationPredecessors(snapshot);
  if (parents !== null)
    return (
      snapshot.workstreamId !== predecessor.workstreamId &&
      parents.some(
        (parent) =>
          parent.workstreamId === predecessor.workstreamId &&
          parent.snapshotContentHash === predecessor.snapshotContentHash,
      )
    );
  if (snapshot.origin.reconciliationPredecessors !== undefined) return false;
  // ADR-0199: a settled completed or cancelled head may be exactly succeeded; unsettled may not.
  return (
    (predecessor.status === "completed" || predecessor.status === "cancelled") &&
    predecessor.blockers.length === 0 &&
    (predecessor.pendingDecisions?.length ?? 0) === 0 &&
    (predecessor.pendingApprovals?.length ?? 0) === 0 &&
    snapshot.origin.kind === "successor" &&
    snapshot.workstreamId !== predecessor.workstreamId &&
    snapshot.origin.predecessorWorkstreamId === predecessor.workstreamId &&
    snapshot.origin.predecessorSnapshotContentHash === predecessor.snapshotContentHash
  );
}
/** A reconciliation preserves both exact heads without declaring either task completed. */
export function workstreamReconciliationPredecessors(snapshot: WorkstreamSnapshot) {
  const origin = snapshot.origin;
  const parents = origin.reconciliationPredecessors;
  if (
    origin.kind !== "successor" ||
    parents === undefined ||
    parents.length !== 2 ||
    parents[0]?.snapshotContentHash === parents[1]?.snapshotContentHash ||
    parents.some((parent) => parent.workstreamId === snapshot.workstreamId) ||
    !parents.some(
      (parent) =>
        parent.workstreamId === origin.predecessorWorkstreamId &&
        parent.snapshotContentHash === origin.predecessorSnapshotContentHash,
    )
  )
    return null;
  return parents;
}
export function isWorkstreamSuccessorRoot(
  snapshot: WorkstreamSnapshot,
  predecessor: WorkstreamSnapshot & { snapshotContentHash: string },
): boolean {
  return snapshot.revision === 1 && hasWorkstreamPredecessor(snapshot, predecessor);
}
export type WorkstreamSnapshotRecordedEventPayload = FromSchema<
  typeof workstreamSnapshotRecordedEventPayloadSchema
>;
