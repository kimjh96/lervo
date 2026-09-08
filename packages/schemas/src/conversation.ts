import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  conversationIdSchema,
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
export type ConversationAgentBinding = FromSchema<typeof conversationAgentBindingSchema>;
export type ConversationTarget = FromSchema<typeof conversationTargetSchema>;
export type ConversationAdapterCapability = (typeof conversationAdapterCapabilities)[number];
export type ConversationAdapterDescriptor = FromSchema<typeof conversationAdapterDescriptorSchema>;
