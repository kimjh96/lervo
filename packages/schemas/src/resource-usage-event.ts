import type { FromSchema } from "json-schema-to-ts";

import { providerSchema, sha256Schema } from "./common.js";
import { workIdSchema } from "./execution-observability-event.js";
import {
  hostedModelIdentitySchema,
  providerModelIdentitySchema,
} from "./provider-model-identity.js";

const nullableAgentIdSchema = {
  anyOf: [{ type: "string", pattern: "^agt_[a-f0-9]{24}$" }, { type: "null" }],
} as const;
const reasonCodeSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,63}$",
} as const;

export const resourceUsageSchema = {
  type: "object",
  properties: {
    inputTokens: { type: "integer", minimum: 0 },
    cachedInputTokens: { type: "integer", minimum: 0 },
    outputTokens: { type: "integer", minimum: 0 },
    reasoningOutputTokens: { type: "integer", minimum: 0 },
    totalTokens: { type: "integer", minimum: 0 },
    contextWindow: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
  },
  required: [
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalTokens",
    "contextWindow",
  ],
  additionalProperties: false,
} as const;

/** ADR-0459 measurement channels; a usage record names exactly one. */
export const resourceUsageChannels = [
  "terminal",
  "managed_run",
  "conversation",
  "supervision",
  "knowledge_worker",
  "deliberation",
] as const;

/**
 * Attribution binds usage to the agent, conversation, channel, turn, and stage that spent it.
 * Historical events omit it; a writer that records one field records all five.
 */
const resourceUsageAttributionProperties = {
  agentId: nullableAgentIdSchema,
  conversationDigest: { anyOf: [sha256Schema, { type: "null" }] },
  channel: { type: "string", enum: resourceUsageChannels },
  turnEventId: { type: "string", pattern: "^[a-z]{3,4}_[A-Za-z0-9][A-Za-z0-9_-]{7,95}$" },
  stage: reasonCodeSchema,
} as const;

/** ADR-0632: the hosted provider session that spent the usage; the session is a digest. */
const resourceUsageHostedSessionSchema = {
  type: "object",
  properties: { providerSessionDigest: sha256Schema, provider: providerSchema },
  required: ["providerSessionDigest", "provider"],
  additionalProperties: false,
} as const;

const resourceUsageRecordedProperties = {
  /** Null only for a hosted session's usage, which no managed work caused. */
  workId: { anyOf: [workIdSchema, { type: "null" }] },
  resourceObservationId: { type: "string", pattern: "^ruo_[a-f0-9]{24}$" },
  sourceCoordinateDigest: sha256Schema,
  scope: {
    type: "string",
    enum: [
      "primary_provider",
      "subagent_provider",
      "query_projection",
      "publication_evaluation",
      "deliberation",
      "improvement_evaluation",
    ],
  },
  source: { type: "string", enum: ["provider_reported", "lervo_measured", "estimated"] },
  accountingMode: {
    type: "string",
    enum: ["turn_cumulative", "session_cumulative", "operation_delta"],
  },
  accountingDescriptorHash: sha256Schema,
  modelIdentity: { anyOf: [providerModelIdentitySchema, hostedModelIdentitySchema] },
  status: { type: "string", enum: ["observed", "partial", "unavailable", "invalid"] },
  usage: { anyOf: [resourceUsageSchema, { type: "null" }] },
  reasonCode: { anyOf: [reasonCodeSchema, { type: "null" }] },
  ...resourceUsageAttributionProperties,
  hostedSession: resourceUsageHostedSessionSchema,
  /**
   * Schema 11, hosted records only for now. Cache-creation tokens, a part of `usage.inputTokens`
   * as cache reads are; the shared usage shape lacks it.
   */
  cacheCreationInputTokens: { type: "integer", minimum: 0 },
  /** Schema 11. The provider's list-price estimate, or null with `costBasis: unreported`. */
  costUsd: { anyOf: [{ type: "number", minimum: 0, maximum: 1_000_000 }, { type: "null" }] },
  costBasis: { type: "string", enum: ["list", "unreported"] },
} as const;

export const resourceUsageRecordedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/resource-usage-recorded-event-payload.schema.json",
  type: "object",
  properties: resourceUsageRecordedProperties,
  required: [
    "workId",
    "resourceObservationId",
    "sourceCoordinateDigest",
    "scope",
    "source",
    "accountingMode",
    "accountingDescriptorHash",
    "modelIdentity",
    "status",
    "usage",
    "reasonCode",
  ],
  dependentRequired: {
    costUsd: ["costBasis"],
    costBasis: ["costUsd"],
    agentId: ["conversationDigest", "channel", "turnEventId", "stage"],
    conversationDigest: ["agentId", "channel", "turnEventId", "stage"],
    channel: ["agentId", "conversationDigest", "turnEventId", "stage"],
    turnEventId: ["agentId", "conversationDigest", "channel", "stage"],
    stage: ["agentId", "conversationDigest", "channel", "turnEventId"],
  },
  allOf: [
    {
      oneOf: [
        {
          properties: {
            status: { const: "observed" },
            usage: resourceUsageSchema,
            reasonCode: { type: "null" },
          },
          required: ["status", "usage", "reasonCode"],
        },
        {
          properties: {
            status: { const: "partial" },
            usage: resourceUsageSchema,
            reasonCode: reasonCodeSchema,
          },
          required: ["status", "usage", "reasonCode"],
        },
        {
          properties: {
            status: { enum: ["unavailable", "invalid"] },
            usage: { type: "null" },
            reasonCode: reasonCodeSchema,
          },
          required: ["status", "usage", "reasonCode"],
        },
      ],
    },
    {
      oneOf: [
        {
          // Managed readers parse versions 2 and 3 only, so managed records carry none of the
          // schema-11 fields until those readers select records by attribution.
          properties: {
            workId: workIdSchema,
            modelIdentity: providerModelIdentitySchema,
            hostedSession: false,
            cacheCreationInputTokens: false,
            costUsd: false,
            costBasis: false,
          },
        },
        {
          // A hosted session's usage names its session and no work, agent, or turn.
          properties: {
            workId: { type: "null" },
            modelIdentity: hostedModelIdentitySchema,
            source: { const: "provider_reported" },
            // A result that reported no usage records nothing.
            status: { enum: ["observed", "partial"] },
            hostedSession: resourceUsageHostedSessionSchema,
            cacheCreationInputTokens: resourceUsageRecordedProperties.cacheCreationInputTokens,
            costUsd: resourceUsageRecordedProperties.costUsd,
            costBasis: resourceUsageRecordedProperties.costBasis,
            agentId: false,
            conversationDigest: false,
            channel: false,
            turnEventId: false,
            stage: false,
          },
          required: ["hostedSession", "cacheCreationInputTokens", "costUsd", "costBasis"],
        },
      ],
    },
    {
      if: { properties: { costBasis: { const: "list" } }, required: ["costBasis"] },
      then: { properties: { costUsd: { type: "number" } } },
    },
    {
      if: { properties: { costBasis: { const: "unreported" } }, required: ["costBasis"] },
      then: { properties: { costUsd: { type: "null" } } },
    },
  ],
  additionalProperties: false,
} as const;

/**
 * An envelope invariant: below schema 11, `resource.usage.recorded` stays the managed shape older
 * readers accept, with a work ID and none of the fields schema 11 added. The payload schema itself
 * ignores the envelope version.
 */
export const resourceUsageBeforeV11 = {
  if: {
    properties: {
      type: { const: "resource.usage.recorded" },
      schemaVersion: { type: "integer", maximum: 10 },
    },
    required: ["type", "schemaVersion"],
  },
  then: {
    properties: {
      payload: {
        type: "object",
        properties: { workId: { type: "string" } },
        propertyNames: {
          not: { enum: ["hostedSession", "cacheCreationInputTokens", "costUsd", "costBasis"] },
        },
      },
    },
  },
} as const;

export type ResourceUsage = FromSchema<typeof resourceUsageSchema>;
export type ResourceUsageRecordedEventPayload = FromSchema<
  typeof resourceUsageRecordedEventPayloadSchema
>;
export type ResourceUsageChannel = (typeof resourceUsageChannels)[number];
export interface ResourceUsageAttribution {
  agentId: string | null;
  conversationDigest: string | null;
  channel: ResourceUsageChannel;
  turnEventId: string;
  stage: string;
}
