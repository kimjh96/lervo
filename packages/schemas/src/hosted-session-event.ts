import type { FromSchema } from "json-schema-to-ts";
import { providerSchema, sha256Schema, timestampSchema } from "./common.js";

/**
 * Schema 10: the ADE's hosted sessions (ADR-0613, ade-sessions.md). A session is named by the
 * digest of the provider session UUID that Lervo prepared; the UUID itself never leaves the host.
 * No payload carries instruction text, arguments, environment values, or paths. The envelope's
 * `occurredAt` and `policyVersion` date each event and bind it to the policy in force.
 */
export const hostedSessionEventTypes = [
  "application.workspace.started",
  "terminal.session.launch_prepared",
  "terminal.session.launched",
  "terminal.session.ended",
] as const;

const workspaceId = { type: "string", pattern: "^wsp_[a-f0-9]{24}$" } as const;
const workstreamId = { type: "string", pattern: "^wks_[a-f0-9]{24}$" } as const;
/** `lervo workspace start` names branches `lervo/<words>-<6 hex>` from the title's ASCII words. */
const workspaceBranch = {
  type: "string",
  maxLength: 64,
  pattern: "^lervo/[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{6}$",
} as const;
const conversationMode = { type: "string", enum: ["native", "cli"] } as const;

export const applicationWorkspaceStartedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/application-workspace-started-event-payload.schema.json",
  type: "object",
  properties: {
    workspaceId,
    workstreamId,
    branch: workspaceBranch,
    providerSessionDigest: sha256Schema,
    instructionDigest: sha256Schema,
    startedAt: timestampSchema,
  },
  required: [
    "workspaceId",
    "workstreamId",
    "branch",
    "providerSessionDigest",
    "instructionDigest",
    "startedAt",
  ],
  additionalProperties: false,
} as const;

export const terminalSessionLaunchPreparedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/terminal-session-launch-prepared-event-payload.schema.json",
  type: "object",
  properties: {
    providerSessionDigest: sha256Schema,
    provider: providerSchema,
    workspaceId,
    conversationMode,
    /** sha256 of the launch descriptor record, which digests the arguments and settings. */
    descriptorDigest: sha256Schema,
  },
  required: [
    "providerSessionDigest",
    "provider",
    "workspaceId",
    "conversationMode",
    "descriptorDigest",
  ],
  additionalProperties: false,
} as const;

export const terminalSessionLaunchedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/terminal-session-launched-event-payload.schema.json",
  type: "object",
  properties: {
    providerSessionDigest: sha256Schema,
    provider: providerSchema,
    descriptorDigest: sha256Schema,
  },
  required: ["providerSessionDigest", "provider", "descriptorDigest"],
  additionalProperties: false,
} as const;

/**
 * Why a hosted session ended. The first four come from the provider's `SessionEnd` hook, with any
 * reason it adds later recorded as `other`; `process_exited` means the session host saw the
 * process exit without that hook.
 */
export const hostedSessionEndReasons = [
  "clear",
  "logout",
  "prompt_input_exit",
  "other",
  "process_exited",
] as const;

export const terminalSessionEndedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/terminal-session-ended-event-payload.schema.json",
  type: "object",
  properties: {
    providerSessionDigest: sha256Schema,
    endReason: { type: "string", enum: hostedSessionEndReasons },
    /** The process exit code when it exited normally; null for a signal or when unknown. */
    exitCode: { anyOf: [{ type: "integer", minimum: 0, maximum: 255 }, { type: "null" }] },
  },
  required: ["providerSessionDigest", "endReason", "exitCode"],
  additionalProperties: false,
} as const;

export type ApplicationWorkspaceStartedEventPayload = FromSchema<
  typeof applicationWorkspaceStartedEventPayloadSchema
>;
export type TerminalSessionLaunchPreparedEventPayload = FromSchema<
  typeof terminalSessionLaunchPreparedEventPayloadSchema
>;
export type TerminalSessionLaunchedEventPayload = FromSchema<
  typeof terminalSessionLaunchedEventPayloadSchema
>;
export type TerminalSessionEndedEventPayload = FromSchema<
  typeof terminalSessionEndedEventPayloadSchema
>;
