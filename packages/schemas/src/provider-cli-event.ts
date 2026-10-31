import type { FromSchema } from "json-schema-to-ts";
import { sha256Schema, timestampSchema } from "./common.js";

export const providerCliExposedTools = [
  "exec",
  "spawn_agent",
  "request_user_input",
  "send_input",
  "wait",
  "close_agent",
  "apply_patch",
  "shell",
  "shell_command",
  "read_file",
  "write_file",
  "web_search",
  "web_fetch",
  "mcp",
  "permission_request",
  "other",
] as const;
export const providerCliRejectionReasons = [
  "capabilities_exposed",
  "probe_failed",
  "probe_timed_out",
  "identity_changed",
] as const;
const common = {
  provider: { enum: ["codex", "claude"] },
  version: {
    type: "string",
    pattern: "^\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z0-9.-]{1,40})?$",
    maxLength: 80,
  },
  executableHash: sha256Schema,
  hostLabel: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,31}$" },
} as const;
export const providerCliAdmittedEventPayloadSchema = {
  type: "object",
  properties: { ...common, probeResultHash: sha256Schema, admittedAt: timestampSchema },
  required: ["provider", "version", "executableHash", "probeResultHash", "hostLabel", "admittedAt"],
  additionalProperties: false,
} as const;
export const providerCliRejectedEventPayloadSchema = {
  type: "object",
  properties: {
    ...common,
    reason: { enum: providerCliRejectionReasons },
    exposedTools: {
      type: "array",
      maxItems: 16,
      uniqueItems: true,
      items: { enum: providerCliExposedTools },
    },
    rejectedAt: timestampSchema,
  },
  required: [
    "provider",
    "version",
    "executableHash",
    "reason",
    "exposedTools",
    "hostLabel",
    "rejectedAt",
  ],
  additionalProperties: false,
} as const;
export type ProviderCliAdmittedEventPayload = FromSchema<
  typeof providerCliAdmittedEventPayloadSchema
>;
export type ProviderCliRejectedEventPayload = FromSchema<
  typeof providerCliRejectedEventPayloadSchema
>;
