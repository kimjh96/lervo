import type { FromSchema } from "json-schema-to-ts";

import {
  conversationEventIdSchema,
  eventIdSchema,
  sha256Schema,
  timestampSchema,
  workforceAgentIdSchema,
} from "./common.js";

export const conversationRepositoryKnowledgeResolvedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/conversation-repository-knowledge-resolved-event-payload.schema.json",
  type: "object",
  properties: {
    completionEventId: eventIdSchema,
    completionEventHash: sha256Schema,
    sourceConversationEventId: conversationEventIdSchema,
    jobId: { type: "string", pattern: "^kjb_[a-f0-9]{24}$" },
    agentId: workforceAgentIdSchema,
    sourceManifest: {
      oneOf: [
        {
          type: "object",
          properties: {
            kind: { type: "string", const: "content_bound" },
            contentHash: sha256Schema,
            byteCount: { type: "integer", minimum: 1, maximum: 1_048_576 },
          },
          required: ["kind", "contentHash", "byteCount"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { kind: { type: "string", const: "legacy_unavailable" } },
          required: ["kind"],
          additionalProperties: false,
        },
      ],
    },
    terminalState: {
      type: "string",
      enum: ["current", "pending_review", "stale", "attention_required"],
    },
    attemptCount: { type: "integer", minimum: 1, maximum: 16 },
    failureCode: {
      anyOf: [{ type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" }, { type: "null" }],
    },
    knowledgeSnapshotHash: { anyOf: [sha256Schema, { type: "null" }] },
    resolvedAt: timestampSchema,
  },
  required: [
    "completionEventId",
    "completionEventHash",
    "sourceConversationEventId",
    "jobId",
    "agentId",
    "sourceManifest",
    "terminalState",
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
          sourceManifest: {
            type: "object",
            properties: { kind: { const: "content_bound" } },
            required: ["kind"],
          },
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

export type ConversationRepositoryKnowledgeResolvedEventPayload = FromSchema<
  typeof conversationRepositoryKnowledgeResolvedEventPayloadSchema
>;
