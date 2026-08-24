import type { FromSchema } from "json-schema-to-ts";

import { eventIdSchema, sha256Schema, timestampSchema } from "./common.js";

export const terminalTurnDeclaredEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/terminal-turn-declared-event-payload.schema.json",
  type: "object",
  properties: {
    declarationId: { type: "string", pattern: "^tdecl_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$" },
    contextEventId: eventIdSchema,
    repositoryRevision: sha256Schema,
    taskMode: { type: "string", enum: ["inquiry", "change", "review", "continuation", "approval_response"] },
    canonicalizationDisposition: {
      type: "string",
      enum: ["not_applicable_read_only", "canonical_sources_current", "canonical_sources_updated", "pending_user_approval"],
    },
    knowledgeDisposition: {
      type: "string",
      enum: ["not_applicable_read_only", "current", "refreshed", "pending_user_approval"],
    },
    deliberationDisposition: { type: "string", enum: ["not_requested", "completed", "no_consensus", "failed"] },
    deliberationId: {
      anyOf: [
        { type: "string", pattern: "^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$" },
        { type: "null" },
      ],
    },
    declaredAt: timestampSchema,
  },
  required: [
    "declarationId",
    "contextEventId",
    "repositoryRevision",
    "taskMode",
    "canonicalizationDisposition",
    "knowledgeDisposition",
    "deliberationDisposition",
    "deliberationId",
    "declaredAt",
  ],
  allOf: [
    {
      if: { properties: { deliberationDisposition: { const: "not_requested" } }, required: ["deliberationDisposition"] },
      then: { properties: { deliberationId: { type: "null" } } },
      else: { properties: { deliberationId: { type: "string" } } },
    },
  ],
  additionalProperties: false,
} as const;

export type TerminalTurnDeclaredEventPayload = FromSchema<typeof terminalTurnDeclaredEventPayloadSchema>;
