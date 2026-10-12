import type { FromSchema } from "json-schema-to-ts";

import { projectIdSchema, sha256Schema } from "./common.js";

export const contextQualityIdentifierSchema = {
  type: "string",
  pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$",
} as const;
const locale = { type: "string", pattern: "^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$" } as const;
const nullableLocale = { anyOf: [locale, { type: "null" }] } as const;
const labels = {
  type: "array",
  maxItems: 32,
  uniqueItems: true,
  items: contextQualityIdentifierSchema,
} as const;

export const contextQualityTaskSchema = {
  type: "object",
  properties: {
    intent: { type: "string", minLength: 1, maxLength: 16384 },
    continuation: { type: "string", maxLength: 16384 },
    targetPaths: {
      type: "array",
      maxItems: 64,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 1024 },
    },
    artifactKinds: labels,
    requestedActions: labels,
    conversationLocale: nullableLocale,
    publicationLocale: nullableLocale,
    retrievalLanguages: { type: "array", maxItems: 8, uniqueItems: true, items: locale },
  },
  required: [
    "intent",
    "continuation",
    "targetPaths",
    "artifactKinds",
    "requestedActions",
    "conversationLocale",
    "publicationLocale",
    "retrievalLanguages",
  ],
  additionalProperties: false,
} as const;

export const contextQualityProfileSchema = {
  type: "object",
  properties: {
    maximumBytes: { type: "integer", minimum: 1, maximum: 1048576 },
    maximumTokens: { type: "integer", minimum: 1, maximum: 1048576 },
    deadlineMs: { type: "integer", minimum: 1, maximum: 600000 },
    maximumConcurrent: { type: "integer", minimum: 1, maximum: 2 },
    maximumPending: { type: "integer", minimum: 0, maximum: 32 },
    maximumRetainedBytes: { type: "integer", minimum: 1, maximum: 2147483647 },
    maximumProviderCalls: { type: "integer", minimum: 0, maximum: 16 },
  },
  required: [
    "maximumBytes",
    "maximumTokens",
    "deadlineMs",
    "maximumConcurrent",
    "maximumPending",
    "maximumRetainedBytes",
    "maximumProviderCalls",
  ],
  additionalProperties: false,
} as const;

export const contextQualityBindingsSchema = {
  type: "object",
  properties: {
    projectId: projectIdSchema,
    taskRevision: { type: "integer", minimum: 1, maximum: 2147483647 },
    taskDigest: sha256Schema,
    scopeDigest: sha256Schema,
    policySetDigest: sha256Schema,
    sourceSnapshotId: contextQualityIdentifierSchema,
    retrievalPlanId: contextQualityIdentifierSchema,
    profileId: contextQualityIdentifierSchema,
    profile: contextQualityProfileSchema,
    builds: {
      type: "object",
      properties: {
        core: sha256Schema,
        retrieval: sha256Schema,
        projector: { anyOf: [sha256Schema, { type: "null" }] },
      },
      required: ["core", "retrieval", "projector"],
      additionalProperties: false,
    },
    projectedQueries: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    executionCapabilities: {
      type: "object",
      properties: {
        controlledProviderInput: { type: "boolean" },
        exactDeliveryAcknowledgement: { type: "boolean" },
        observedArtifactAccess: { type: "boolean" },
        controlledConsequentialEffects: { type: "boolean" },
      },
      required: [
        "controlledProviderInput",
        "exactDeliveryAcknowledgement",
        "observedArtifactAccess",
        "controlledConsequentialEffects",
      ],
      additionalProperties: false,
    },
  },
  required: [
    "projectId",
    "taskRevision",
    "taskDigest",
    "scopeDigest",
    "policySetDigest",
    "sourceSnapshotId",
    "retrievalPlanId",
    "profileId",
    "profile",
    "builds",
    "projectedQueries",
    "executionCapabilities",
  ],
  additionalProperties: false,
} as const;

export const contextQualityIngressSchema = {
  $id: "https://schemas.lervo.dev/v1/context-quality-ingress.schema.json",
  type: "object",
  properties: {
    schemaVersion: { const: 1 },
    requestId: contextQualityIdentifierSchema,
    projectId: projectIdSchema,
    taskRevision: { type: "integer", minimum: 1, maximum: 2147483647 },
    task: contextQualityTaskSchema,
    origin: {
      type: "object",
      properties: {
        kind: { enum: ["terminal", "managed_run", "conversation", "native_chat"] },
        adapterBuildId: sha256Schema,
        correlationId: contextQualityIdentifierSchema,
      },
      required: ["kind", "adapterBuildId", "correlationId"],
      additionalProperties: false,
    },
  },
  required: ["schemaVersion", "requestId", "projectId", "taskRevision", "task", "origin"],
  additionalProperties: false,
} as const;

export const contextQualityRequestSchema = {
  $id: "https://schemas.lervo.dev/v1/context-quality-request.schema.json",
  type: "object",
  properties: {
    ...contextQualityIngressSchema.properties,
    ...contextQualityBindingsSchema.properties,
    profileDigest: sha256Schema,
    semanticInputDigest: sha256Schema,
  },
  required: [
    ...contextQualityIngressSchema.required,
    ...contextQualityBindingsSchema.required.filter(
      (name) => name !== "projectId" && name !== "taskRevision",
    ),
    "profileDigest",
    "semanticInputDigest",
  ],
  additionalProperties: false,
} as const;

export type ContextQualityIngress = FromSchema<typeof contextQualityIngressSchema>;
export type ContextQualityBindings = FromSchema<typeof contextQualityBindingsSchema>;
export type ContextQualityRequest = FromSchema<typeof contextQualityRequestSchema>;
