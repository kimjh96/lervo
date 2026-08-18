import type { FromSchema } from "json-schema-to-ts";

import {
  documentIdSchema,
  eventIdSchema,
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
import { eventTypes } from "./event.js";

const adapterIdSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_-]*(/[a-z][a-z0-9_-]*)?$",
} as const;

const capabilitySupportSchema = {
  type: "string",
  enum: ["supported", "unsupported", "unknown"],
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
    type: { type: "string", enum: eventTypes },
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
    adapterNormalizedEventSchema,
    adapterStopRequestSchema,
    adapterStopResultSchema,
  ],
} as const;

export type AdapterDescriptor = FromSchema<typeof adapterDescriptorSchema>;
export type AdapterStartRequest = FromSchema<typeof adapterStartRequestSchema>;
export type AdapterSession = FromSchema<typeof adapterSessionSchema>;
export type AdapterContextEnvelope = FromSchema<typeof adapterContextEnvelopeSchema>;
export type AdapterContextReceipt = FromSchema<typeof adapterContextReceiptSchema>;
export type AdapterNormalizedEvent = FromSchema<typeof adapterNormalizedEventSchema>;
export type AdapterStopRequest = FromSchema<typeof adapterStopRequestSchema>;
export type AdapterStopResult = FromSchema<typeof adapterStopResultSchema>;
export type AdapterContractMessage = FromSchema<typeof adapterContractMessageSchema>;
