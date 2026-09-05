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
    supersededByPatternId: { anyOf: [patternIdSchema, { type: "null" }] },
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

const protocolIdSchema = { type: "string", pattern: "^ieprotocol_[a-f0-9]{24}$" } as const;
const planIdSchema = { type: "string", pattern: "^ieplan_[a-f0-9]{24}$" } as const;
const eventIdSchema = { type: "string", pattern: "^evt_[a-f0-9]{24,32}$" } as const;
const adapterIdSchema = { type: "string", pattern: "^iobs_[A-Za-z0-9._-]{1,123}$" } as const;
const adapterVersionSchema = {
  type: "string",
  pattern: "^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$",
} as const;
const improvementMetricIdSchema = {
  type: "string",
  enum: [
    "source_recall",
    "unnecessary_context",
    "verification_success",
    "repeated_failure",
    "rework",
    "user_correction",
  ],
} as const;

export const developmentPatternEvaluationRegisteredEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/development-pattern-evaluation-registered-event-payload.schema.json",
  type: "object",
  properties: {
    protocolId: protocolIdSchema,
    patternId: patternIdSchema,
    protocolPlanId: planIdSchema,
    protocolArtifactId: artifactIdSchema,
    protocolArtifactHash: sha256Schema,
    candidateContentHash: sha256Schema,
    reviewContentHash: sha256Schema,
    targetContentHash: sha256Schema,
    adapterId: adapterIdSchema,
    adapterVersion: adapterVersionSchema,
    adapterDescriptorHash: sha256Schema,
    baselineWindowHash: sha256Schema,
    baselineObservationHash: sha256Schema,
    metricIds: {
      type: "array",
      items: improvementMetricIdSchema,
      minItems: 1,
      maxItems: 6,
      uniqueItems: true,
    },
    registeredAt: timestampSchema,
  },
  required: [
    "protocolId",
    "patternId",
    "protocolPlanId",
    "protocolArtifactId",
    "protocolArtifactHash",
    "candidateContentHash",
    "reviewContentHash",
    "targetContentHash",
    "adapterId",
    "adapterVersion",
    "adapterDescriptorHash",
    "baselineWindowHash",
    "baselineObservationHash",
    "metricIds",
    "registeredAt",
  ],
  additionalProperties: false,
} as const;

export const developmentPatternEffectObservedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/development-pattern-effect-observed-event-payload.schema.json",
  type: "object",
  properties: {
    comparisonId: { type: "string", pattern: "^iecomparison_[a-f0-9]{24}$" },
    patternId: patternIdSchema,
    protocolId: protocolIdSchema,
    comparisonPlanId: planIdSchema,
    comparisonArtifactId: artifactIdSchema,
    comparisonArtifactHash: sha256Schema,
    registrationEventId: eventIdSchema,
    promotionEventId: eventIdSchema,
    targetContentHash: sha256Schema,
    adapterId: adapterIdSchema,
    adapterVersion: adapterVersionSchema,
    adapterDescriptorHash: sha256Schema,
    treatmentWindowHash: sha256Schema,
    treatmentObservationHash: sha256Schema,
    overall: {
      type: "string",
      enum: [
        "favorable_observation",
        "mixed_or_unfavorable_observation",
        "no_material_difference",
        "inconclusive",
      ],
    },
    attribution: { type: "string", const: "unestablished" },
    rollbackDisposition: { type: "string", enum: ["not_authorized", "review_required"] },
    metricCount: { type: "integer", minimum: 1, maximum: 6 },
    observedAt: timestampSchema,
  },
  required: [
    "comparisonId",
    "patternId",
    "protocolId",
    "comparisonPlanId",
    "comparisonArtifactId",
    "comparisonArtifactHash",
    "registrationEventId",
    "promotionEventId",
    "targetContentHash",
    "adapterId",
    "adapterVersion",
    "adapterDescriptorHash",
    "treatmentWindowHash",
    "treatmentObservationHash",
    "overall",
    "attribution",
    "rollbackDisposition",
    "metricCount",
    "observedAt",
  ],
  additionalProperties: false,
} as const;

export type DevelopmentPatternObservedEventPayload = FromSchema<
  typeof developmentPatternObservedEventPayloadSchema
>;
export type DevelopmentPatternTransitionedEventPayload = FromSchema<
  typeof developmentPatternTransitionedEventPayloadSchema
>;
export type DevelopmentPatternEvaluationRegisteredEventPayload = FromSchema<
  typeof developmentPatternEvaluationRegisteredEventPayloadSchema
>;
export type DevelopmentPatternEffectObservedEventPayload = FromSchema<
  typeof developmentPatternEffectObservedEventPayloadSchema
>;
