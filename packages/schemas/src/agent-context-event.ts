import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  eventIdSchema,
  sha256Schema,
  timestampSchema,
  workforceAgentIdSchema,
} from "./common.js";

const contextEntryIdSchema = {
  type: "string",
  pattern: "^actx_[a-f0-9]{24}$",
} as const;

const contextHandoffIdSchema = {
  type: "string",
  pattern: "^ach_[a-f0-9]{24}$",
} as const;

export const agentContextPromotedEventPayloadSchema = {
  type: "object",
  properties: {
    contextEntryId: contextEntryIdSchema,
    agentId: workforceAgentIdSchema,
    layer: { type: "string", enum: ["work", "relationship", "expertise"] },
    source: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["event", "artifact"] },
        sourceId: {
          type: "string",
          minLength: 1,
          maxLength: 160,
          pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        },
        contentHash: sha256Schema,
      },
      required: ["kind", "sourceId", "contentHash"],
      additionalProperties: false,
    },
    summaryArtifactId: artifactIdSchema,
    summaryContentHash: sha256Schema,
    summaryByteCount: { type: "integer", minimum: 1, maximum: 32_768 },
    reviewEventId: eventIdSchema,
    reviewEventHash: sha256Schema,
    supersedesContextEntryId: {
      anyOf: [contextEntryIdSchema, { type: "null" }],
    },
    promotedAt: timestampSchema,
  },
  required: [
    "contextEntryId",
    "agentId",
    "layer",
    "source",
    "summaryArtifactId",
    "summaryContentHash",
    "summaryByteCount",
    "reviewEventId",
    "reviewEventHash",
    "supersedesContextEntryId",
    "promotedAt",
  ],
  additionalProperties: false,
} as const;

export const agentContextHandoffRecordedEventPayloadSchema = {
  type: "object",
  properties: {
    contextHandoffId: contextHandoffIdSchema,
    fromAgentId: workforceAgentIdSchema,
    toAgentId: workforceAgentIdSchema,
    contextEntryIds: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      uniqueItems: true,
      items: contextEntryIdSchema,
    },
    manifestArtifactId: artifactIdSchema,
    manifestContentHash: sha256Schema,
    manifestByteCount: { type: "integer", minimum: 1, maximum: 32_768 },
    recordedAt: timestampSchema,
  },
  required: [
    "contextHandoffId",
    "fromAgentId",
    "toAgentId",
    "contextEntryIds",
    "manifestArtifactId",
    "manifestContentHash",
    "manifestByteCount",
    "recordedAt",
  ],
  additionalProperties: false,
} as const;

export type AgentContextPromotedEventPayload = FromSchema<
  typeof agentContextPromotedEventPayloadSchema
>;
export type AgentContextHandoffRecordedEventPayload = FromSchema<
  typeof agentContextHandoffRecordedEventPayloadSchema
>;
