import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  deliberationArtifactIdSchema,
  deliberationIdSchema,
  deliberationObjectionIdSchema,
  deliberationOutcomeIdSchema,
  deliberationPolicyIdSchema,
  roleIdSchema,
  sha256Schema,
  writingPublicationPermitIdSchema,
} from "./common.js";
import { deliberationArtifactKinds } from "./deliberation-artifact.js";

export const deliberationStartedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/deliberation-started-event-payload.schema.json",
  type: "object",
  properties: {
    deliberationId: deliberationIdSchema,
    policyId: deliberationPolicyIdSchema,
    policyHash: sha256Schema,
    participantRoleIds: {
      type: "array",
      items: roleIdSchema,
      minItems: 2,
      maxItems: 16,
      uniqueItems: true,
    },
    maxRounds: { type: "integer", minimum: 1, maximum: 20 },
  },
  required: ["deliberationId", "policyId", "policyHash", "participantRoleIds", "maxRounds"],
  additionalProperties: false,
} as const;

export const deliberationArtifactRecordedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/deliberation-artifact-recorded-event-payload.schema.json",
  type: "object",
  properties: {
    deliberationId: deliberationIdSchema,
    deliberationArtifactId: deliberationArtifactIdSchema,
    kind: { type: "string", enum: deliberationArtifactKinds },
    round: { type: "integer", minimum: 1, maximum: 20 },
    producerRoleId: roleIdSchema,
    artifactId: artifactIdSchema,
    contentHash: sha256Schema,
    writingPermitId: writingPublicationPermitIdSchema,
  },
  required: [
    "deliberationId",
    "deliberationArtifactId",
    "kind",
    "round",
    "producerRoleId",
    "artifactId",
    "contentHash",
    "writingPermitId",
  ],
  additionalProperties: false,
} as const;

const completedCommon = {
  deliberationId: deliberationIdSchema,
  outcomeId: deliberationOutcomeIdSchema,
  lastRound: { type: "integer", minimum: 1, maximum: 20 },
  unresolvedBlockingObjectionIds: {
    type: "array",
    items: deliberationObjectionIdSchema,
    maxItems: 100,
    uniqueItems: true,
  },
} as const;

const completedRequired = [
  "deliberationId",
  "outcomeId",
  "status",
  "lastRound",
  "decisionArtifactId",
  "unresolvedBlockingObjectionIds",
  "failurePhase",
  "failureCode",
] as const;

export const deliberationCompletedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/deliberation-completed-event-payload.schema.json",
  oneOf: [
    {
      type: "object",
      properties: {
        ...completedCommon,
        status: { const: "converged" },
        decisionArtifactId: deliberationArtifactIdSchema,
        unresolvedBlockingObjectionIds: {
          type: "array",
          items: deliberationObjectionIdSchema,
          maxItems: 0,
        },
        failurePhase: { type: "null" },
        failureCode: { type: "null" },
      },
      required: completedRequired,
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...completedCommon,
        status: { const: "no_consensus" },
        decisionArtifactId: { type: "null" },
        failurePhase: { type: "null" },
        failureCode: { type: "null" },
      },
      required: completedRequired,
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...completedCommon,
        status: { const: "failed" },
        decisionArtifactId: { type: "null" },
        failurePhase: {
          type: "string",
          enum: [
            "provider",
            "context",
            "telemetry",
            "artifact",
            "writing",
            "verification",
            "contract",
          ],
        },
        failureCode: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
      },
      required: completedRequired,
      additionalProperties: false,
    },
  ],
} as const;

export type DeliberationStartedEventPayload = FromSchema<
  typeof deliberationStartedEventPayloadSchema
>;
export type DeliberationArtifactRecordedEventPayload = FromSchema<
  typeof deliberationArtifactRecordedEventPayloadSchema
>;
export type DeliberationCompletedEventPayload = FromSchema<
  typeof deliberationCompletedEventPayloadSchema
>;
