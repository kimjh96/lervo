import type { FromSchema } from "json-schema-to-ts";

import {
  deliberationArtifactIdSchema,
  deliberationIdSchema,
  deliberationObjectionIdSchema,
  deliberationOutcomeIdSchema,
  deliberationPolicyIdSchema,
  projectIdSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";

const commonProperties = {
  schemaVersion: schemaVersionSchema,
  outcomeId: deliberationOutcomeIdSchema,
  deliberationId: deliberationIdSchema,
  projectId: projectIdSchema,
  policyId: deliberationPolicyIdSchema,
  policyHash: sha256Schema,
  lastRound: { type: "integer", minimum: 1, maximum: 20 },
  artifactIds: {
    type: "array",
    items: deliberationArtifactIdSchema,
    maxItems: 500,
    uniqueItems: true,
  },
  lastConfirmedArtifactId: {
    anyOf: [deliberationArtifactIdSchema, { type: "null" }],
  },
  completedAt: timestampSchema,
} as const;

const commonRequired = [
  "schemaVersion",
  "outcomeId",
  "deliberationId",
  "projectId",
  "policyId",
  "policyHash",
  "status",
  "lastRound",
  "artifactIds",
  "lastConfirmedArtifactId",
  "decisionArtifactId",
  "passedVerificationArtifactIds",
  "unresolvedBlockingObjectionIds",
  "noConsensusReason",
  "failure",
  "completedAt",
] as const;

const convergedOutcomeSchema = {
  type: "object",
  properties: {
    ...commonProperties,
    status: { const: "converged" },
    artifactIds: { ...commonProperties.artifactIds, minItems: 1 },
    decisionArtifactId: deliberationArtifactIdSchema,
    passedVerificationArtifactIds: {
      type: "array",
      items: deliberationArtifactIdSchema,
      minItems: 1,
      maxItems: 32,
      uniqueItems: true,
    },
    unresolvedBlockingObjectionIds: {
      type: "array",
      items: deliberationObjectionIdSchema,
      maxItems: 0,
    },
    noConsensusReason: { type: "null" },
    failure: { type: "null" },
  },
  required: commonRequired,
  additionalProperties: false,
} as const;

const noConsensusOutcomeSchema = {
  type: "object",
  properties: {
    ...commonProperties,
    status: { const: "no_consensus" },
    artifactIds: { ...commonProperties.artifactIds, minItems: 1 },
    decisionArtifactId: { type: "null" },
    passedVerificationArtifactIds: {
      type: "array",
      items: deliberationArtifactIdSchema,
      maxItems: 32,
      uniqueItems: true,
    },
    unresolvedBlockingObjectionIds: {
      type: "array",
      items: deliberationObjectionIdSchema,
      maxItems: 100,
      uniqueItems: true,
    },
    noConsensusReason: {
      type: "string",
      enum: [
        "max_rounds_reached",
        "blocking_objections_unresolved",
        "required_verification_not_passed",
      ],
    },
    failure: { type: "null" },
  },
  required: commonRequired,
  additionalProperties: false,
} as const;

const failedOutcomeSchema = {
  type: "object",
  properties: {
    ...commonProperties,
    status: { const: "failed" },
    decisionArtifactId: { type: "null" },
    passedVerificationArtifactIds: {
      type: "array",
      items: deliberationArtifactIdSchema,
      maxItems: 32,
      uniqueItems: true,
    },
    unresolvedBlockingObjectionIds: {
      type: "array",
      items: deliberationObjectionIdSchema,
      maxItems: 100,
      uniqueItems: true,
    },
    noConsensusReason: { type: "null" },
    failure: {
      type: "object",
      properties: {
        phase: {
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
        code: {
          type: "string",
          pattern: "^[a-z][a-z0-9_]{0,63}$",
        },
        retryable: { type: "boolean" },
      },
      required: ["phase", "code", "retryable"],
      additionalProperties: false,
    },
  },
  required: commonRequired,
  additionalProperties: false,
} as const;

export const deliberationOutcomeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/deliberation-outcome.schema.json",
  title: "Lervo deliberation terminal outcome",
  oneOf: [convergedOutcomeSchema, noConsensusOutcomeSchema, failedOutcomeSchema],
} as const;

export type DeliberationOutcome = FromSchema<typeof deliberationOutcomeSchema>;
