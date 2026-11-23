import type { FromSchema } from "json-schema-to-ts";

import { codeSchema, identifierSchema, parametersSchema } from "./primitives.js";

/** Forwards a Lervo application command, such as `workspace.start`, to the resident process. */
export const applicationCommandMessageSchema = {
  title: "ApplicationCommandMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "command", "arguments"],
  properties: {
    kind: { type: "string", enum: ["application.command"] },
    requestId: identifierSchema,
    command: { type: "string", pattern: "^[a-z]+(\\.[a-z_]+)+$", maxLength: 64 },
    arguments: { type: "object", maxProperties: 32 },
  },
} as const;

export const applicationResultMessageSchema = {
  title: "ApplicationResultMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "result"],
  properties: {
    kind: { type: "string", enum: ["application.result"] },
    requestId: identifierSchema,
    result: { type: "object", maxProperties: 32 },
  },
} as const;

export const requestFailedMessageSchema = {
  title: "RequestFailedMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "code", "parameters"],
  properties: {
    kind: { type: "string", enum: ["request.failed"] },
    requestId: identifierSchema,
    code: {
      enum: [
        "workspace_start_failed",
        "session_not_found",
        "session_ended",
        "provider_cli_unavailable",
        "provider_login_unavailable",
        "range_invalid",
        "conversation_mode_unsupported",
        "conversation_index_corrupt",
        "workspace_not_found",
        "launch_intent_invalid",
        "application_failed",
        "application_unavailable",
        "application_timeout",
        "session_start_failed",
        "session_stop_timeout",
      ],
    },
    parameters: parametersSchema,
  },
} as const;

/** A notice-only condition. The interface renders the code from its message catalog. */
export const noticeMessageSchema = {
  title: "NoticeMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "code", "parameters"],
  properties: {
    kind: { type: "string", enum: ["notice"] },
    code: codeSchema,
    parameters: parametersSchema,
  },
} as const;

export type ApplicationCommandMessage = FromSchema<typeof applicationCommandMessageSchema>;
export type ApplicationResultMessage = FromSchema<typeof applicationResultMessageSchema>;
export type RequestFailedMessage = FromSchema<typeof requestFailedMessageSchema>;
export type NoticeMessage = FromSchema<typeof noticeMessageSchema>;
