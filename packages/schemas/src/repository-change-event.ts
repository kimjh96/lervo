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

/** The single terminal knowledge outcome for one repository change unit (ADR-0433). */
export const repositoryKnowledgeResolvedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/repository-knowledge-resolved-event-payload.schema.json",
  type: "object",
  properties: {
    changeEventId: eventIdSchema,
    changeEventHash: sha256Schema,
    sourceKind: { type: "string", enum: ["conversation", "managed_run", "terminal_turn"] },
    terminalState: {
      type: "string",
      enum: ["current", "pending_review", "stale", "attention_required"],
    },
    classification: {
      anyOf: [
        {
          type: "string",
          enum: ["implementation_only", "canonical_change_candidate", "needs_review"],
        },
        { type: "null" },
      ],
    },
    attemptCount: { type: "integer", minimum: 1, maximum: 16 },
    failureCode: {
      anyOf: [{ type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" }, { type: "null" }],
    },
    knowledgeSnapshotHash: { anyOf: [sha256Schema, { type: "null" }] },
    /** The registered canonicalization candidate that assigns the canonical write. */
    canonicalizationCandidateId: {
      anyOf: [{ type: "string", pattern: "^kcanon_[a-f0-9]{24}$" }, { type: "null" }],
    },
    resolvedAt: timestampSchema,
  },
  required: [
    "changeEventId",
    "changeEventHash",
    "sourceKind",
    "terminalState",
    "classification",
    "attemptCount",
    "failureCode",
    "knowledgeSnapshotHash",
    "resolvedAt",
  ],
  allOf: [
    {
      if: { properties: { terminalState: { const: "current" } }, required: ["terminalState"] },
      then: {
        properties: {
          knowledgeSnapshotHash: sha256Schema,
          failureCode: { type: "null" },
          classification: { type: "string", const: "implementation_only" },
        },
      },
      else: { properties: { knowledgeSnapshotHash: { type: "null" } } },
    },
    {
      if: {
        properties: { terminalState: { const: "attention_required" } },
        required: ["terminalState"],
      },
      then: { properties: { failureCode: { type: "string" } } },
    },
  ],
  additionalProperties: false,
} as const;

export type RepositoryKnowledgeResolvedEventPayload = FromSchema<
  typeof repositoryKnowledgeResolvedEventPayloadSchema
>;
