import type { FromSchema } from "json-schema-to-ts";

import {
  conversationEventIdSchema,
  conversationIdSchema,
  conversationParticipationDecisionIdSchema,
  conversationParticipationPolicyIdSchema,
  projectIdSchema,
  roleIdSchema,
  schemaVersionSchema,
  timestampSchema,
} from "./common.js";

export const conversationParticipationReasons = [
  "silent",
  "actor_not_allowed",
  "automation_depth_exceeded",
  "not_mentioned",
  "not_relevant",
  "relevance_unavailable",
  "signal_not_subscribed",
  "publication_observation_only",
  "turn_not_owned",
  "cooldown",
  "rate_limited",
  "owned_human_message",
  "mentioned",
  "relevant",
  "proactive_signal",
] as const;

export const conversationParticipationPolicySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/conversation-participation-policy.schema.json",
  title: "Lervo conversation participation policy",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    policyId: conversationParticipationPolicyIdSchema,
    projectId: projectIdSchema,
    roleId: roleIdSchema,
    conversationIds: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
      items: conversationIdSchema,
    },
    mode: {
      type: "string",
      enum: ["mention_only", "relevant", "proactive", "silent"],
    },
    respondTo: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: ["human", "agent", "system"] },
    },
    unaddressedHumanMessages: {
      type: "string",
      enum: ["evaluate", "respond"],
    },
    signalCodes: {
      type: "array",
      maxItems: 64,
      uniqueItems: true,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
      },
    },
    cooldownSeconds: { type: "integer", minimum: 0, maximum: 86_400 },
    maxResponsesPerHour: { type: "integer", minimum: 1, maximum: 60 },
    maxAutomationDepth: { type: "integer", minimum: 0, maximum: 32 },
    createdAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "policyId",
    "projectId",
    "roleId",
    "conversationIds",
    "mode",
    "respondTo",
    "signalCodes",
    "cooldownSeconds",
    "maxResponsesPerHour",
    "maxAutomationDepth",
    "createdAt",
  ],
  additionalProperties: false,
} as const;

export const conversationParticipationDecisionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/conversation-participation-decision.schema.json",
  title: "Lervo conversation participation decision",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    decisionId: conversationParticipationDecisionIdSchema,
    eventId: conversationEventIdSchema,
    policyId: conversationParticipationPolicyIdSchema,
    projectId: projectIdSchema,
    conversationId: conversationIdSchema,
    roleId: roleIdSchema,
    action: { type: "string", enum: ["observe", "respond"] },
    reason: { type: "string", enum: conversationParticipationReasons },
    relevance: {
      type: "string",
      enum: ["not_checked", "relevant", "not_relevant", "unknown"],
    },
    decidedAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "decisionId",
    "eventId",
    "policyId",
    "projectId",
    "conversationId",
    "roleId",
    "action",
    "reason",
    "relevance",
    "decidedAt",
  ],
  additionalProperties: false,
} as const;

export type ConversationParticipationPolicy = FromSchema<
  typeof conversationParticipationPolicySchema
>;
export type ConversationParticipationDecision = FromSchema<
  typeof conversationParticipationDecisionSchema
>;
export type ConversationParticipationReason = (typeof conversationParticipationReasons)[number];
