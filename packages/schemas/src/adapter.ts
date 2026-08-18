import type { FromSchema } from "json-schema-to-ts";

import {
  documentIdSchema,
  eventIdSchema,
  projectIdSchema,
  providerSchema,
  repositoryRelativePathSchema,
  roleIdSchema,
  runIdSchema,
  schemaVersionSchema,
  scopeSchema,
  sessionIdSchema,
  sha256Schema,
  timestampSchema,
  writingPolicyIdSchema,
} from "./common.js";

const adapterIdSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_-]*(/[a-z][a-z0-9_-]*)?$",
} as const;

const capabilitySupportSchema = {
  type: "string",
  enum: ["supported", "unsupported", "unknown"],
} as const;

const adapterExecutionModeSchema = {
  type: "string",
  enum: ["read_only", "managed_write"],
} as const;

const capabilityMatrixSchema = {
  type: "object",
  properties: {
    controlledContextInjection: capabilitySupportSchema,
    toolCalls: capabilitySupportSchema,
    commandExecution: capabilitySupportSchema,
    fileChanges: capabilitySupportSchema,
    contextCompaction: capabilitySupportSchema,
    sessionResume: capabilitySupportSchema,
    usage: capabilitySupportSchema,
  },
  required: [
    "controlledContextInjection",
    "toolCalls",
    "commandExecution",
    "fileChanges",
    "contextCompaction",
    "sessionResume",
    "usage"
  ],
  additionalProperties: false,
} as const;

export const adapterDescriptorSchema = {
  type: "object",
  properties: {
    kind: { const: "descriptor" },
    schemaVersion: schemaVersionSchema,
    adapterId: adapterIdSchema,
    adapterVersion: { type: "string", minLength: 1 },
    provider: providerSchema,
    capabilities: capabilityMatrixSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    "adapterId",
    "adapterVersion",
    "provider",
    "capabilities"
  ],
  additionalProperties: false,
} as const;

export const adapterStartRequestSchema = {
  type: "object",
  properties: {
    kind: { const: "start_request" },
    schemaVersion: schemaVersionSchema,
    adapterId: adapterIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    roleId: roleIdSchema,
    writingPolicyId: {
      anyOf: [writingPolicyIdSchema, { type: "null" }],
    },
    requestDigest: sha256Schema,
    executionMode: adapterExecutionModeSchema,
    requestedAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    "adapterId",
    "projectId",
    "runId",
    "sessionId",
    "roleId",
    "writingPolicyId",
    "requestDigest",
    "executionMode",
    "requestedAt"
  ],
  additionalProperties: false,
} as const;

export const adapterSessionSchema = {
  type: "object",
  properties: {
    kind: { const: "session" },
    schemaVersion: schemaVersionSchema,
    adapterId: adapterIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    roleId: roleIdSchema,
    writingPolicyId: {
      anyOf: [writingPolicyIdSchema, { type: "null" }],
    },
    provider: providerSchema,
    providerSessionId: { type: "string", minLength: 1 },
    executionMode: adapterExecutionModeSchema,
    startedAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    "adapterId",
    "projectId",
    "runId",
    "sessionId",
    "roleId",
    "writingPolicyId",
    "provider",
    "providerSessionId",
    "executionMode",
    "startedAt"
  ],
  additionalProperties: false,
} as const;

const contextDocumentSchema = {
  type: "object",
  properties: {
    documentId: { type: "string", pattern: "^doc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$" },
    path: { type: "string", minLength: 1 },
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 0 },
    scope: scopeSchema,
    delivery: {
      oneOf: [
        {
          type: "object",
          properties: {
            kind: { const: "inline" },
            content: { type: "string" },
          },
          required: ["kind", "content"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "cas" },
            uri: { type: "string", pattern: "^roven-cas://sha256/[a-f0-9]{64}$" },
          },
          required: ["kind", "uri"],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ["documentId", "path", "contentHash", "byteCount", "scope", "delivery"],
  additionalProperties: false,
} as const;

export const adapterContextEnvelopeSchema = {
  type: "object",
  properties: {
    kind: { const: "context_envelope" },
    schemaVersion: schemaVersionSchema,
    envelopeId: { type: "string", minLength: 1 },
    adapterId: adapterIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    roleId: roleIdSchema,
    writingPolicyId: {
      anyOf: [writingPolicyIdSchema, { type: "null" }],
    },
    writingPolicyDocumentId: {
      anyOf: [documentIdSchema, { type: "null" }],
    },
    targetTurnId: { type: "string", minLength: 1 },
    contextGeneration: { type: "integer", minimum: 0 },
    documents: {
      type: "array",
      items: contextDocumentSchema,
      minItems: 1,
    },
    createdAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    "envelopeId",
    "adapterId",
    "projectId",
    "runId",
    "sessionId",
    "roleId",
    "writingPolicyId",
    "writingPolicyDocumentId",
    "targetTurnId",
    "contextGeneration",
    "documents",
    "createdAt"
  ],
  allOf: [
    {
      if: {
        properties: { writingPolicyId: { type: "null" } },
        required: ["writingPolicyId"],
      },
      then: {
        properties: { writingPolicyDocumentId: { type: "null" } },
      },
      else: {
        properties: { writingPolicyDocumentId: documentIdSchema },
      },
    },
  ],
  additionalProperties: false,
} as const;

const injectedDocumentSchema = {
  type: "object",
  properties: {
    documentId: { type: "string", pattern: "^doc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$" },
    contentHash: sha256Schema,
    scope: scopeSchema,
    status: { const: "injected" },
  },
  required: ["documentId", "contentHash", "scope", "status"],
  additionalProperties: false,
} as const;

export const adapterContextReceiptSchema = {
  type: "object",
  properties: {
    kind: { const: "context_receipt" },
    schemaVersion: schemaVersionSchema,
    receiptId: { type: "string", pattern: "^ctx_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$" },
    envelopeId: { type: "string", minLength: 1 },
    adapterId: adapterIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    roleId: roleIdSchema,
    writingPolicyId: {
      anyOf: [writingPolicyIdSchema, { type: "null" }],
    },
    writingPolicyDocumentId: {
      anyOf: [documentIdSchema, { type: "null" }],
    },
    provider: providerSchema,
    providerSessionId: { type: "string", minLength: 1 },
    targetTurnId: { type: "string", minLength: 1 },
    contextGeneration: { type: "integer", minimum: 0 },
    controlledInput: { const: true },
    documents: {
      type: "array",
      items: injectedDocumentSchema,
      minItems: 1,
    },
    acceptedAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    "receiptId",
    "envelopeId",
    "adapterId",
    "projectId",
    "runId",
    "sessionId",
    "roleId",
    "writingPolicyId",
    "writingPolicyDocumentId",
    "provider",
    "providerSessionId",
    "targetTurnId",
    "contextGeneration",
    "controlledInput",
    "documents",
    "acceptedAt"
  ],
  allOf: [
    {
      if: {
        properties: { writingPolicyId: { type: "null" } },
        required: ["writingPolicyId"],
      },
      then: {
        properties: { writingPolicyDocumentId: { type: "null" } },
      },
      else: {
        properties: { writingPolicyDocumentId: documentIdSchema },
      },
    },
  ],
  additionalProperties: false,
} as const;

export const adapterTurnRequestSchema = {
  type: "object",
  properties: {
    kind: { const: "turn_request" },
    schemaVersion: schemaVersionSchema,
    adapterId: adapterIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    providerSessionId: { type: "string", minLength: 1 },
    targetTurnId: { type: "string", minLength: 1 },
    instructions: { type: "string", minLength: 1 },
    requestedAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    "adapterId",
    "projectId",
    "runId",
    "sessionId",
    "providerSessionId",
    "targetTurnId",
    "instructions",
    "requestedAt"
  ],
  additionalProperties: false,
} as const;

export const adapterTurnSchema = {
  type: "object",
  properties: {
    kind: { const: "turn" },
    schemaVersion: schemaVersionSchema,
    adapterId: adapterIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    providerSessionId: { type: "string", minLength: 1 },
    targetTurnId: { type: "string", minLength: 1 },
    providerTurnId: { type: "string", minLength: 1 },
    acceptedAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    "adapterId",
    "projectId",
    "runId",
    "sessionId",
    "providerSessionId",
    "targetTurnId",
    "providerTurnId",
    "acceptedAt"
  ],
  additionalProperties: false,
} as const;

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

export const adapterTurnResultSchema = {
  type: "object",
  properties: {
    kind: { const: "turn_result" },
    schemaVersion: schemaVersionSchema,
    adapterId: adapterIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    providerSessionId: { type: "string", minLength: 1 },
    targetTurnId: { type: "string", minLength: 1 },
    providerTurnId: { type: "string", minLength: 1 },
    mediaType: { const: "text/markdown; charset=utf-8" },
    content: { type: "string", minLength: 1 },
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 1 },
    producedAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    "adapterId",
    "projectId",
    "runId",
    "sessionId",
    "providerSessionId",
    "targetTurnId",
    "providerTurnId",
    "mediaType",
    "content",
    "contentHash",
    "byteCount",
    "producedAt"
  ],
  additionalProperties: false,
} as const;

export const adapterNormalizedEventTypes = [
  "provider.session.started",
  "provider.session.restarted",
  "provider.session.stopped",
  "provider.context.compacted",
  "provider.turn.started",
  "provider.turn.completed",
  "provider.turn.failed",
  "provider.tool.called",
  "provider.command.executed",
  "provider.file_change.reported",
  "provider.usage.updated",
  "provider.error",
] as const;

const providerEventPayloadRules = [
  {
    if: { properties: { type: { const: "provider.session.started" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: { adapterVersion: { type: "string", minLength: 1 } },
          required: ["adapterVersion"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.session.restarted" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            reason: { type: "string", enum: ["process_restarted", "session_resumed"] },
          },
          required: ["reason"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.session.stopped" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["completed", "failed", "cancelled", "unknown"] },
          },
          required: ["status"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.context.compacted" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerTurnId: { type: "string", minLength: 1 },
            providerItemId: { type: "string", minLength: 1 },
          },
          required: ["providerTurnId", "providerItemId"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.turn.started" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: { providerTurnId: { type: "string", minLength: 1 } },
          required: ["providerTurnId"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.turn.completed" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerTurnId: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["completed", "interrupted"] },
            durationMs: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
          },
          required: ["providerTurnId", "status", "durationMs"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.turn.failed" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerTurnId: { type: "string", minLength: 1 },
            failureCode: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
            diagnosticDigest: sha256Schema,
          },
          required: ["providerTurnId", "failureCode", "diagnosticDigest"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.tool.called" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerItemId: { type: "string", minLength: 1 },
            toolName: { type: "string", minLength: 1 },
            inputDigest: sha256Schema,
            status: { type: "string", enum: ["in_progress", "completed", "failed", "declined"] },
            durationMs: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
          },
          required: ["providerItemId", "toolName", "inputDigest", "status", "durationMs"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.command.executed" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerItemId: { type: "string", minLength: 1 },
            commandDigest: sha256Schema,
            cwdRelative: { anyOf: [repositoryRelativePathSchema, { const: "." }, { type: "null" }] },
            status: { type: "string", enum: ["in_progress", "completed", "failed", "declined"] },
            exitCode: { anyOf: [{ type: "integer" }, { type: "null" }] },
            outputDigest: { anyOf: [sha256Schema, { type: "null" }] },
            durationMs: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
          },
          required: [
            "providerItemId",
            "commandDigest",
            "cwdRelative",
            "status",
            "exitCode",
            "outputDigest",
            "durationMs"
          ],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.file_change.reported" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerItemId: { type: "string", minLength: 1 },
            paths: { type: "array", items: repositoryRelativePathSchema, minItems: 1 },
            changeKinds: {
              type: "array",
              items: { type: "string", enum: ["created", "modified", "deleted", "moved"] },
              minItems: 1,
            },
            status: { type: "string", enum: ["in_progress", "completed", "failed", "declined"] },
            diffDigest: sha256Schema,
          },
          required: ["providerItemId", "paths", "changeKinds", "status", "diffDigest"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.usage.updated" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerTurnId: { type: "string", minLength: 1 },
            inputTokens: { type: "integer", minimum: 0 },
            cachedInputTokens: { type: "integer", minimum: 0 },
            outputTokens: { type: "integer", minimum: 0 },
            reasoningOutputTokens: { type: "integer", minimum: 0 },
            totalTokens: { type: "integer", minimum: 0 },
            contextWindow: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
          },
          required: [
            "providerTurnId",
            "inputTokens",
            "cachedInputTokens",
            "outputTokens",
            "reasoningOutputTokens",
            "totalTokens",
            "contextWindow"
          ],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.error" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            failureCode: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
            diagnosticDigest: sha256Schema,
            retryable: { type: "boolean" },
          },
          required: ["failureCode", "diagnosticDigest", "retryable"],
          additionalProperties: false,
        },
      },
    },
  },
] as const;

export const adapterNormalizedEventSchema = {
  type: "object",
  properties: {
    kind: { const: "normalized_event" },
    schemaVersion: schemaVersionSchema,
    eventId: eventIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    providerSessionId: { type: "string", minLength: 1 },
    type: { type: "string", enum: adapterNormalizedEventTypes },
    occurredAt: timestampSchema,
    payload: { type: "object" },
  },
  required: [
    "kind",
    "schemaVersion",
    "eventId",
    "projectId",
    "runId",
    "sessionId",
    "providerSessionId",
    "type",
    "occurredAt",
    "payload"
  ],
  allOf: providerEventPayloadRules,
  additionalProperties: false,
} as const;

export const adapterStopRequestSchema = {
  type: "object",
  properties: {
    kind: { const: "stop_request" },
    schemaVersion: schemaVersionSchema,
    adapterId: adapterIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    providerSessionId: { type: "string", minLength: 1 },
    reason: { type: "string", enum: ["completed", "failed", "cancelled"] },
    requestedAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    "adapterId",
    "projectId",
    "runId",
    "sessionId",
    "providerSessionId",
    "reason",
    "requestedAt"
  ],
  additionalProperties: false,
} as const;

export const adapterStopResultSchema = {
  type: "object",
  properties: {
    kind: { const: "stop_result" },
    schemaVersion: schemaVersionSchema,
    adapterId: adapterIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    providerSessionId: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["completed", "failed", "cancelled"] },
    stoppedAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    "adapterId",
    "projectId",
    "runId",
    "sessionId",
    "providerSessionId",
    "status",
    "stoppedAt"
  ],
  additionalProperties: false,
} as const;

export const adapterContractMessageSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.roven.dev/v0/adapter-contract.schema.json",
  title: "Roven provider adapter contract message",
  oneOf: [
    adapterDescriptorSchema,
    adapterStartRequestSchema,
    adapterSessionSchema,
    adapterContextEnvelopeSchema,
    adapterContextReceiptSchema,
    adapterTurnRequestSchema,
    adapterTurnSchema,
    adapterManagedWriteRequestSchema,
    adapterManagedWriteDecisionSchema,
    adapterManagedWriteCompletionSchema,
    adapterTurnResultSchema,
    adapterNormalizedEventSchema,
    adapterStopRequestSchema,
    adapterStopResultSchema,
  ],
} as const;

export type AdapterDescriptor = FromSchema<typeof adapterDescriptorSchema>;
export type AdapterStartRequest = FromSchema<typeof adapterStartRequestSchema>;
export type AdapterSession = FromSchema<typeof adapterSessionSchema>;
export type AdapterExecutionMode = AdapterStartRequest["executionMode"];
export type AdapterContextEnvelope = FromSchema<typeof adapterContextEnvelopeSchema>;
export type AdapterContextReceipt = FromSchema<typeof adapterContextReceiptSchema>;
export type AdapterTurnRequest = FromSchema<typeof adapterTurnRequestSchema>;
export type AdapterTurn = FromSchema<typeof adapterTurnSchema>;
export type AdapterManagedWriteRequest = FromSchema<typeof adapterManagedWriteRequestSchema>;
export type AdapterManagedWriteDecision = FromSchema<typeof adapterManagedWriteDecisionSchema>;
export type AdapterManagedWriteCompletion = FromSchema<typeof adapterManagedWriteCompletionSchema>;
export type AdapterTurnResult = FromSchema<typeof adapterTurnResultSchema>;
export type AdapterNormalizedEvent = FromSchema<typeof adapterNormalizedEventSchema>;
export type AdapterNormalizedEventType = (typeof adapterNormalizedEventTypes)[number];
export type AdapterStopRequest = FromSchema<typeof adapterStopRequestSchema>;
export type AdapterStopResult = FromSchema<typeof adapterStopResultSchema>;
export type AdapterContractMessage = FromSchema<typeof adapterContractMessageSchema>;
