import type { FromSchema } from "json-schema-to-ts";

import {
  projectIdSchema,
  repositoryRelativePathSchema,
  runIdSchema,
  schemaVersionSchema,
  sessionIdSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";
import { adapterIdSchema } from "./adapter-primitives.js";

const adapterManagedWriteCoordinates = {
  adapterId: adapterIdSchema,
  projectId: projectIdSchema,
  runId: runIdSchema,
  sessionId: sessionIdSchema,
  providerSessionId: { type: "string", minLength: 1 },
  targetTurnId: { type: "string", minLength: 1 },
  providerTurnId: { type: "string", minLength: 1 },
  providerItemId: { type: "string", minLength: 1 },
  path: repositoryRelativePathSchema,
  targetDigest: sha256Schema,
  changeKind: { type: "string", enum: ["created", "modified", "deleted", "upsert"] },
} as const;

const adapterManagedWriteCoordinateFields = [
  "adapterId",
  "projectId",
  "runId",
  "sessionId",
  "providerSessionId",
  "targetTurnId",
  "providerTurnId",
  "providerItemId",
  "path",
  "targetDigest",
  "changeKind",
] as const;

export const adapterManagedWriteRequestSchema = {
  type: "object",
  properties: {
    kind: { const: "managed_write_request" },
    schemaVersion: schemaVersionSchema,
    ...adapterManagedWriteCoordinates,
    requestedAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    ...adapterManagedWriteCoordinateFields,
    "requestedAt",
  ],
  additionalProperties: false,
} as const;

export const adapterManagedWriteDecisionSchema = {
  type: "object",
  properties: {
    kind: { const: "managed_write_decision" },
    schemaVersion: schemaVersionSchema,
    ...adapterManagedWriteCoordinates,
    decision: { type: "string", enum: ["allow", "deny"] },
    reasonCode: {
      type: "string",
      enum: [
        "authorized",
        "approval_required",
        "bridge_unavailable",
        "capability_denied",
        "invalid_request",
        "required_context_missing",
        "telemetry_recording_failed",
      ],
    },
    decidedAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    ...adapterManagedWriteCoordinateFields,
    "decision",
    "reasonCode",
    "decidedAt",
  ],
  additionalProperties: false,
} as const;

export const adapterManagedWriteCompletionSchema = {
  type: "object",
  properties: {
    kind: { const: "managed_write_completion" },
    schemaVersion: schemaVersionSchema,
    ...adapterManagedWriteCoordinates,
    status: { type: "string", enum: ["completed", "failed", "declined"] },
    completedAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    ...adapterManagedWriteCoordinateFields,
    "status",
    "completedAt",
  ],
  additionalProperties: false,
} as const;

export type AdapterManagedWriteRequest = FromSchema<typeof adapterManagedWriteRequestSchema>;
export type AdapterManagedWriteDecision = FromSchema<typeof adapterManagedWriteDecisionSchema>;
export type AdapterManagedWriteCompletion = FromSchema<typeof adapterManagedWriteCompletionSchema>;

