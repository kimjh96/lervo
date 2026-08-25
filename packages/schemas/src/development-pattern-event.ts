import type { FromSchema } from "json-schema-to-ts";

import { artifactIdSchema, sha256Schema, timestampSchema } from "./common.js";

const patternIdSchema = { type: "string", pattern: "^pattern_[a-f0-9]{24}$" } as const;

export const developmentPatternObservedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/development-pattern-observed-event-payload.schema.json",
  type: "object",
  properties: {
    patternId: patternIdSchema,
    observationId: { type: "string", pattern: "^dpobs_[a-f0-9]{24}$" },
    provider: { type: "string", enum: ["codex", "claude"] },
    sourceSnapshotId: { type: "string", pattern: "^ksnap_[a-f0-9]{24}$" },
    sourceSnapshotHash: sha256Schema,
    evidenceDigest: sha256Schema,
    occurrenceCount: { type: "integer", minimum: 2, maximum: 64 },
    observedAt: timestampSchema,
  },
  required: [
    "patternId",
    "observationId",
    "provider",
    "sourceSnapshotId",
    "sourceSnapshotHash",
    "evidenceDigest",
    "occurrenceCount",
    "observedAt",
  ],
  additionalProperties: false,
} as const;

export const developmentPatternTransitionedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/development-pattern-transitioned-event-payload.schema.json",
  type: "object",
  properties: {
    transitionId: { type: "string", pattern: "^dptr_[a-f0-9]{24}$" },
    patternId: patternIdSchema,
    fromState: {
      anyOf: [
        {
          type: "string",
          enum: ["observed", "candidate", "reviewed", "promoted", "rejected", "deferred"],
        },
        { type: "null" },
      ],
    },
    toState: {
      type: "string",
      enum: ["candidate", "reviewed", "promoted", "rejected", "deferred", "superseded"],
    },
    candidateArtifactId: { anyOf: [artifactIdSchema, { type: "null" }] },
    candidateContentHash: { anyOf: [sha256Schema, { type: "null" }] },
    reviewArtifactId: { anyOf: [artifactIdSchema, { type: "null" }] },
    reviewContentHash: { anyOf: [sha256Schema, { type: "null" }] },
    targetKind: {
      type: "string",
      enum: [
        "repository_instruction",
        "scoped_instruction",
        "portable_skill",
        "decision",
        "automated_check",
      ],
    },
    approvalHash: { anyOf: [sha256Schema, { type: "null" }] },
    occurredAt: timestampSchema,
  },
  required: [
    "transitionId",
    "patternId",
    "fromState",
    "toState",
    "candidateArtifactId",
    "candidateContentHash",
    "reviewArtifactId",
    "reviewContentHash",
    "targetKind",
    "approvalHash",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export type DevelopmentPatternObservedEventPayload = FromSchema<
  typeof developmentPatternObservedEventPayloadSchema
>;
export type DevelopmentPatternTransitionedEventPayload = FromSchema<
  typeof developmentPatternTransitionedEventPayloadSchema
>;
