import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  conversationIdSchema,
  conversationParticipantIdSchema,
  conversationThreadIdSchema,
  integrationIdSchema,
  projectIdSchema,
  schemaVersionSchema,
  sha256Schema,
  workforceAgentIdSchema,
} from "./common.js";

export const conversationAgentBindingSchema = {
  type: "object",
  properties: {
    agentId: workforceAgentIdSchema,
    roleVersion: {
      type: "string",
      pattern: "^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$",
      maxLength: 100,
    },
    roleContractHash: sha256Schema,
    roleProfileHash: sha256Schema,
  },
  required: ["agentId", "roleVersion", "roleContractHash", "roleProfileHash"],
  additionalProperties: false,
} as const;

export const conversationContentReferenceSchema = {
  type: "object",
  properties: {
    artifactId: artifactIdSchema,
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 1, maximum: 65_536 },
    mediaType: {
      type: "string",
      enum: ["text/plain; charset=utf-8", "text/markdown; charset=utf-8"],
    },
  },
  required: ["artifactId", "contentHash", "byteCount", "mediaType"],
  additionalProperties: false,
} as const;

export const conversationCoordinationSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "discussion.assignment" },
        discussionId: { type: "string", pattern: "^dsc_[A-Za-z0-9_-]{20}$" },
        activeParticipantId: conversationParticipantIdSchema,
        assignmentSequence: { type: "integer", enum: [1, 2] },
      },
      required: ["kind", "discussionId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "discussion.contribution" },
        discussionId: { type: "string", pattern: "^dsc_[A-Za-z0-9_-]{20}$" },
      },
      required: ["kind", "discussionId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "discussion.decision" },
        discussionId: { type: "string", pattern: "^dsc_[A-Za-z0-9_-]{20}$" },
      },
      required: ["kind", "discussionId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "task.assignment" },
        taskId: { type: "string", pattern: "^tsk_[A-Za-z0-9_-]{20}$" },
        coordinatorParticipantId: conversationParticipantIdSchema,
      },
      required: ["kind", "taskId", "coordinatorParticipantId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "task.result" },
        taskId: { type: "string", pattern: "^tsk_[A-Za-z0-9_-]{20}$" },
        coordinatorParticipantId: conversationParticipantIdSchema,
      },
      required: ["kind", "taskId", "coordinatorParticipantId"],
      additionalProperties: false,
    },
  ],
} as const;

export const conversationTargetSchema = {
  type: "object",
  properties: {
    integrationId: integrationIdSchema,
    projectId: projectIdSchema,
    conversationId: conversationIdSchema,
    threadId: { anyOf: [conversationThreadIdSchema, { type: "null" }] },
  },
  required: ["integrationId", "projectId", "conversationId", "threadId"],
  additionalProperties: false,
} as const;

export const conversationAdapterCapabilities = [
  "messages.receive",
  "messages.send",
  "threads",
  "message_revisions",
  "message_deletions",
  "reactions",
  "streaming",
  "typing",
  "presence",
  "interactive_actions",
] as const;

export const conversationAdapterDescriptorSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/conversation-adapter-descriptor.schema.json",
  title: "Lervo conversation adapter descriptor",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    integrationId: integrationIdSchema,
    adapterKind: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z][a-z0-9_-]*$",
    },
    instanceIdentityHash: sha256Schema,
    capabilities: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: conversationAdapterCapabilities },
    },
  },
  required: [
    "schemaVersion",
    "integrationId",
    "adapterKind",
    "instanceIdentityHash",
    "capabilities",
  ],
  additionalProperties: false,
} as const;

export type ConversationContentReference = FromSchema<typeof conversationContentReferenceSchema>;
export type ConversationCoordination = FromSchema<typeof conversationCoordinationSchema>;
export type ConversationAgentBinding = FromSchema<typeof conversationAgentBindingSchema>;
export type ConversationTarget = FromSchema<typeof conversationTargetSchema>;
export type ConversationAdapterCapability = (typeof conversationAdapterCapabilities)[number];
export type ConversationAdapterDescriptor = FromSchema<typeof conversationAdapterDescriptorSchema>;
