import type { FromSchema } from "json-schema-to-ts";

import {
  conversationEventIdSchema,
  conversationParticipantIdSchema,
  roleIdSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";
import {
  conversationContentReferenceSchema,
  conversationTargetSchema,
} from "./conversation.js";

export const conversationInboundEventSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/conversation-inbound-event.schema.json",
  title: "Lervo normalized inbound conversation event",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    eventId: conversationEventIdSchema,
    sourceEventKeyHash: sha256Schema,
    target: conversationTargetSchema,
    kind: { type: "string", enum: ["message.created", "signal.raised"] },
    actor: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["human", "agent", "system"] },
        participantId: conversationParticipantIdSchema,
        roleId: { anyOf: [roleIdSchema, { type: "null" }] },
      },
      required: ["kind", "participantId", "roleId"],
      additionalProperties: false,
    },
    content: conversationContentReferenceSchema,
    mentions: {
      type: "object",
      properties: {
        roleIds: {
          type: "array",
          maxItems: 32,
          uniqueItems: true,
          items: roleIdSchema,
        },
        participantIds: {
          type: "array",
          maxItems: 32,
          uniqueItems: true,
          items: conversationParticipantIdSchema,
        },
      },
      required: ["roleIds", "participantIds"],
      additionalProperties: false,
    },
    replyToEventId: {
      anyOf: [conversationEventIdSchema, { type: "null" }],
    },
    signalCode: {
      anyOf: [
        {
          type: "string",
          minLength: 1,
          maxLength: 100,
          pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
        },
        { type: "null" },
      ],
    },
    automationDepth: { type: "integer", minimum: 0, maximum: 8 },
    occurredAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "eventId",
    "sourceEventKeyHash",
    "target",
    "kind",
    "actor",
    "content",
    "mentions",
    "replyToEventId",
    "signalCode",
    "automationDepth",
    "occurredAt",
  ],
  allOf: [
    {
      if: { properties: { kind: { const: "message.created" } }, required: ["kind"] },
      then: { properties: { signalCode: { type: "null" } } },
    },
    {
      if: { properties: { kind: { const: "signal.raised" } }, required: ["kind"] },
      then: { properties: { signalCode: { type: "string" } } },
    },
    {
      if: {
        properties: {
          actor: { type: "object", properties: { kind: { const: "agent" } } },
        },
      },
      then: {
        properties: {
          actor: { type: "object", properties: { roleId: roleIdSchema } },
        },
      },
    },
    {
      if: {
        properties: {
          actor: {
            type: "object",
            properties: { kind: { enum: ["human", "system"] } },
          },
        },
      },
      then: {
        properties: {
          actor: { type: "object", properties: { roleId: { type: "null" } } },
        },
      },
    },
  ],
  additionalProperties: false,
} as const;

export type ConversationInboundEvent = FromSchema<
  typeof conversationInboundEventSchema
>;
