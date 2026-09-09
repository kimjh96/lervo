import type { FromSchema } from "json-schema-to-ts";

import {
  documentIdSchema,
  eventIdSchema,
  providerSchema,
  receiptIdSchema,
  scopeSchema,
  sha256Schema,
} from "./common.js";
import { providerModelIdentitySchema } from "./provider-model-identity.js";

const providerCoordinateSchema = {
  type: "string",
  minLength: 1,
  maxLength: 256,
} as const;

const injectedDocumentSchema = {
  type: "object",
  properties: {
    evidenceReceiptId: receiptIdSchema,
    documentId: documentIdSchema,
    contentHash: sha256Schema,
    scope: scopeSchema,
  },
  required: ["evidenceReceiptId", "documentId", "contentHash", "scope"],
  additionalProperties: false,
} as const;

export const managedContextInjectedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/managed-context-injected-event-payload.schema.json",
  title: "Lervo managed context injected event payload",
  type: "object",
  properties: {
    receiptId: receiptIdSchema,
    evidenceReceiptIds: { type: "array", minItems: 1, uniqueItems: true, items: receiptIdSchema },
    envelopeId: providerCoordinateSchema,
    documentIds: { type: "array", minItems: 1, uniqueItems: true, items: documentIdSchema },
    targetTurnId: providerCoordinateSchema,
    contextGeneration: { type: "integer", minimum: 0 },
    adapterId: providerCoordinateSchema,
    providerSessionId: providerCoordinateSchema,
    documents: { type: "array", minItems: 1, items: injectedDocumentSchema },
  },
  required: [
    "receiptId",
    "evidenceReceiptIds",
    "envelopeId",
    "documentIds",
    "targetTurnId",
    "contextGeneration",
  ],
  dependentRequired: {
    adapterId: ["providerSessionId", "documents"],
    providerSessionId: ["adapterId", "documents"],
    documents: ["adapterId", "providerSessionId"],
  },
  additionalProperties: false,
} as const;

export const adapterResultCapturedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/adapter-result-captured-event-payload.schema.json",
  title: "Lervo managed adapter result captured event payload",
  type: "object",
  properties: {
    adapterId: providerCoordinateSchema,
    providerSessionId: providerCoordinateSchema,
    targetTurnId: providerCoordinateSchema,
    providerTurnId: providerCoordinateSchema,
    modelIdentity: providerModelIdentitySchema,
    resultDigest: sha256Schema,
    byteCount: { type: "integer", minimum: 1, maximum: 4 * 1024 * 1024 },
    mediaType: { const: "text/markdown; charset=utf-8" },
    referenceTelemetry: { const: "supported" },
  },
  required: [
    "adapterId",
    "providerSessionId",
    "targetTurnId",
    "providerTurnId",
    "modelIdentity",
    "resultDigest",
    "byteCount",
    "mediaType",
    "referenceTelemetry",
  ],
  additionalProperties: false,
} as const;

export const managedContextReferencedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/managed-context-referenced-event-payload.schema.json",
  title: "Lervo managed context referenced event payload",
  type: "object",
  properties: {
    evidenceReceiptId: receiptIdSchema,
    injectedEvidenceReceiptId: receiptIdSchema,
    adapterReceiptId: receiptIdSchema,
    sourceEventId: eventIdSchema,
    documentId: documentIdSchema,
    contentHash: sha256Schema,
    scope: scopeSchema,
    provider: providerSchema,
    providerSessionId: providerCoordinateSchema,
    targetTurnId: providerCoordinateSchema,
    providerTurnId: providerCoordinateSchema,
    contextGeneration: { type: "integer", minimum: 0 },
    referenceKind: { const: "output_citation" },
    citation: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      pattern: "^lervo-e4:doc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}:sha256:[a-f0-9]{64}$",
    },
  },
  required: [
    "evidenceReceiptId",
    "injectedEvidenceReceiptId",
    "adapterReceiptId",
    "sourceEventId",
    "documentId",
    "contentHash",
    "scope",
    "provider",
    "providerSessionId",
    "targetTurnId",
    "providerTurnId",
    "contextGeneration",
    "referenceKind",
    "citation",
  ],
  additionalProperties: false,
} as const;

export type ManagedContextInjectedEventPayload = FromSchema<
  typeof managedContextInjectedEventPayloadSchema
>;
export type AdapterResultCapturedEventPayload = FromSchema<
  typeof adapterResultCapturedEventPayloadSchema
>;
export type ManagedContextReferencedEventPayload = FromSchema<
  typeof managedContextReferencedEventPayloadSchema
>;
