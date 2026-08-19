import type { FromSchema } from "json-schema-to-ts";

import {
  conversationEventIdSchema,
  conversationOutboundIdSchema,
  conversationParticipantIdSchema,
  conversationParticipationPolicyIdSchema,
  integrationIdSchema,
  roleIdSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";
import {
  conversationContentReferenceSchema,
  conversationTargetSchema,
} from "./conversation.js";
import { writingPublicationPermitValueSchema } from "./writing-publication.js";

export const conversationOutboundMessageSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/conversation-outbound-message.schema.json",
  title: "Lervo verified outbound conversation message",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    outboundId: conversationOutboundIdSchema,
    sourceEventId: conversationEventIdSchema,
    policyId: conversationParticipationPolicyIdSchema,
    target: conversationTargetSchema,
    actor: {
      type: "object",
      properties: {
        kind: { const: "agent" },
        participantId: conversationParticipantIdSchema,
        roleId: roleIdSchema,
      },
      required: ["kind", "participantId", "roleId"],
      additionalProperties: false,
    },
    content: conversationContentReferenceSchema,
    publicationPermit: writingPublicationPermitValueSchema,
    automationDepth: { type: "integer", minimum: 1, maximum: 8 },
    createdAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "outboundId",
    "sourceEventId",
    "policyId",
    "target",
    "actor",
    "content",
    "publicationPermit",
    "automationDepth",
    "createdAt",
  ],
  additionalProperties: false,
} as const;

export const conversationDeliveryReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/conversation-delivery-receipt.schema.json",
  title: "Lervo conversation delivery receipt",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    outboundId: conversationOutboundIdSchema,
    integrationId: integrationIdSchema,
    deliveryKeyHash: sha256Schema,
    deliveredAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "outboundId",
    "integrationId",
    "deliveryKeyHash",
    "deliveredAt",
  ],
  additionalProperties: false,
} as const;

export type ConversationOutboundMessage = FromSchema<
  typeof conversationOutboundMessageSchema
>;
export type ConversationDeliveryReceipt = FromSchema<
  typeof conversationDeliveryReceiptSchema
>;
