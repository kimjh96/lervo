import type { FromSchema } from "json-schema-to-ts";

import {
  documentIdSchema,
  projectIdSchema,
  providerSchema,
  roleIdSchema,
  runIdSchema,
  schemaVersionSchema,
  scopeSchema,
  sessionIdSchema,
  sha256Schema,
  timestampSchema,
  writingPolicyIdSchema,
} from "./common.js";

import {
  adapterManagedWriteCompletionSchema,
  adapterManagedWriteDecisionSchema,
  adapterManagedWriteRequestSchema,
} from "./adapter-managed-write.js";
import {
  adapterNormalizedEventSchema,
  adapterNormalizedEventTypes,
} from "./adapter-events.js";
import {
  adapterExecutionModeSchema,
  adapterIdSchema,
  capabilityMatrixSchema,
} from "./adapter-primitives.js";

export {
  adapterManagedWriteCompletionSchema,
  adapterManagedWriteDecisionSchema,
  adapterManagedWriteRequestSchema,
} from "./adapter-managed-write.js";
export type {
  AdapterManagedWriteCompletion,
  AdapterManagedWriteDecision,
  AdapterManagedWriteRequest,
} from "./adapter-managed-write.js";
export {
  adapterNormalizedEventSchema,
  adapterNormalizedEventTypes,
} from "./adapter-events.js";
export type {
  AdapterNormalizedEvent,
  AdapterNormalizedEventType,
} from "./adapter-events.js";

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
    effectiveCapabilities: capabilityMatrixSchema,
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
    "effectiveCapabilities",
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
            uri: { type: "string", pattern: "^lervo-cas://sha256/[a-f0-9]{64}$" },
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
  $id: "https://schemas.lervo.dev/v0/adapter-contract.schema.json",
  title: "Lervo provider adapter contract message",
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
export type AdapterCapabilityMatrix = AdapterDescriptor["capabilities"];
export type AdapterContextEnvelope = FromSchema<typeof adapterContextEnvelopeSchema>;
export type AdapterContextReceipt = FromSchema<typeof adapterContextReceiptSchema>;
export type AdapterTurnRequest = FromSchema<typeof adapterTurnRequestSchema>;
export type AdapterTurn = FromSchema<typeof adapterTurnSchema>;
export type AdapterTurnResult = FromSchema<typeof adapterTurnResultSchema>;
export type AdapterStopRequest = FromSchema<typeof adapterStopRequestSchema>;
export type AdapterStopResult = FromSchema<typeof adapterStopResultSchema>;
export type AdapterContractMessage = FromSchema<typeof adapterContractMessageSchema>;
