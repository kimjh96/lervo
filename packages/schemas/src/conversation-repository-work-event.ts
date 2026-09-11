import type { FromSchema } from "json-schema-to-ts";

import {
  conversationEventIdSchema,
  sha256Schema,
  timestampSchema,
  workforceAgentIdSchema,
} from "./common.js";

const requestedModelSchema = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$",
} as const;

const reasoningEffortSchema = {
  type: "string",
  enum: ["low", "medium", "high", "xhigh", "max"],
} as const;

export const conversationRepositoryWorkCompletedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/conversation-repository-work-completed-event-payload.schema.json",
  type: "object",
  properties: {
    sourceConversationEventId: conversationEventIdSchema,
    workerAgentId: workforceAgentIdSchema,
    providerSessionDigest: sha256Schema,
    requestedModel: { anyOf: [requestedModelSchema, { type: "null" }] },
    requestedReasoningEffort: { anyOf: [reasoningEffortSchema, { type: "null" }] },
    requestContentHash: sha256Schema,
    resultContentHash: sha256Schema,
    resultByteCount: { type: "integer", minimum: 1, maximum: 16_777_216 },
    repositoryRevisionBefore: sha256Schema,
    repositoryRevisionAfter: sha256Schema,
    changedPaths: {
      type: "array",
      maxItems: 64,
      uniqueItems: true,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 500,
        pattern: "^(?!/)(?![A-Za-z]:[/\\\\])(?!.*(?:^|/)\\.\\.(?:/|$))[^\\u0000]+$",
      },
    },
    changedPathCount: { type: "integer", minimum: 0 },
    workstreamId: { type: "string", pattern: "^wks_[a-f0-9]{24}$" },
    workstreamRevision: { type: "integer", minimum: 1 },
    workstreamSnapshotHash: sha256Schema,
    knowledgeDisposition: { type: "string", enum: ["current", "baseline_valid"] },
    replicaDisposition: { type: "string", enum: ["current", "not_configured"] },
    verificationStatus: { type: "string", const: "passed" },
    completedAt: timestampSchema,
  },
  required: [
    "sourceConversationEventId",
    "workerAgentId",
    "providerSessionDigest",
    "requestContentHash",
    "resultContentHash",
    "resultByteCount",
    "repositoryRevisionBefore",
    "repositoryRevisionAfter",
    "changedPaths",
    "changedPathCount",
    "workstreamId",
    "workstreamRevision",
    "workstreamSnapshotHash",
    "knowledgeDisposition",
    "replicaDisposition",
    "verificationStatus",
    "completedAt",
  ],
  additionalProperties: false,
} as const;

export type ConversationRepositoryWorkCompletedEventPayload = FromSchema<
  typeof conversationRepositoryWorkCompletedEventPayloadSchema
>;
