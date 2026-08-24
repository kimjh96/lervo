import type { FromSchema } from "json-schema-to-ts";

import {
  documentIdSchema,
  eventIdSchema,
  projectIdSchema,
  providerSchema,
  receiptIdSchema,
  runIdSchema,
  scopeSchema,
  sessionIdSchema,
  sha256Schema,
} from "./common.js";

const nullableRatioSchema = {
  type: "object",
  properties: {
    numerator: { type: "integer", minimum: 0 },
    denominator: { type: "integer", minimum: 0 },
    value: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] },
    reason: { anyOf: [{ type: "string", minLength: 1, maxLength: 100 }, { type: "null" }] },
  },
  required: ["numerator", "denominator", "value", "reason"],
  additionalProperties: false,
} as const;

const selectionReasonSchema = {
  type: "object",
  properties: {
    eventId: eventIdSchema,
    reasonCode: { type: "string", minLength: 1, maxLength: 64 },
    ruleId: { type: "string", minLength: 1, maxLength: 200 },
    required: { type: "boolean" },
    scope: scopeSchema,
  },
  required: ["eventId", "reasonCode", "ruleId", "required", "scope"],
  additionalProperties: false,
} as const;

const deliverySchema = {
  type: "object",
  properties: {
    eventId: eventIdSchema,
    evidenceReceiptId: receiptIdSchema,
    adapterReceiptId: receiptIdSchema,
    envelopeId: { type: "string", minLength: 1, maxLength: 256 },
    providerSessionId: { type: "string", minLength: 1, maxLength: 256 },
    targetTurnId: { type: "string", minLength: 1, maxLength: 256 },
    contextGeneration: { type: "integer", minimum: 0 },
  },
  required: [
    "eventId",
    "evidenceReceiptId",
    "adapterReceiptId",
    "envelopeId",
    "providerSessionId",
    "targetTurnId",
    "contextGeneration",
  ],
  additionalProperties: false,
} as const;

const referenceSchema = {
  type: "object",
  properties: {
    eventId: eventIdSchema,
    sourceEventId: eventIdSchema,
    evidenceReceiptId: receiptIdSchema,
    injectedEvidenceReceiptId: receiptIdSchema,
    referenceKind: { const: "output_citation" },
    citation: { type: "string", minLength: 1, maxLength: 200 },
    targetTurnId: { type: "string", minLength: 1, maxLength: 256 },
    providerTurnId: { type: "string", minLength: 1, maxLength: 256 },
    contextGeneration: { type: "integer", minimum: 0 },
  },
  required: [
    "eventId",
    "sourceEventId",
    "evidenceReceiptId",
    "injectedEvidenceReceiptId",
    "referenceKind",
    "citation",
    "targetTurnId",
    "providerTurnId",
    "contextGeneration",
  ],
  additionalProperties: false,
} as const;

const documentCoverageSchema = {
  type: "object",
  properties: {
    documentId: documentIdSchema,
    contentHash: { anyOf: [sha256Schema, { type: "null" }] },
    scope: { anyOf: [scopeSchema, { type: "null" }] },
    sourceRevisions: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 500 },
      uniqueItems: true,
      maxItems: 100,
    },
    required: { type: "boolean" },
    highestEvidence: { type: "string", enum: ["selected", "loaded", "injected", "referenced"] },
    selectionReasons: { type: "array", items: selectionReasonSchema, maxItems: 100 },
    loadedEventIds: { type: "array", items: eventIdSchema, uniqueItems: true, maxItems: 100 },
    deliveries: { type: "array", items: deliverySchema, maxItems: 100 },
    references: { type: "array", items: referenceSchema, maxItems: 100 },
    missingStages: {
      type: "array",
      items: { type: "string", enum: ["E1", "E2", "E3", "E4"] },
      uniqueItems: true,
      maxItems: 4,
    },
  },
  required: [
    "documentId",
    "contentHash",
    "scope",
    "sourceRevisions",
    "required",
    "highestEvidence",
    "selectionReasons",
    "loadedEventIds",
    "deliveries",
    "references",
    "missingStages",
  ],
  additionalProperties: false,
} as const;

export const managedContextCoverageReportSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/managed-context-coverage-report.schema.json",
  title: "Lervo managed run context coverage report",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    reportKind: { const: "managed_context" },
    executionMode: { const: "managed" },
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionIds: { type: "array", minItems: 1, uniqueItems: true, items: sessionIdSchema },
    provider: providerSchema,
    status: { type: "string", enum: ["completed", "failed", "incomplete"] },
    capabilities: {
      type: "object",
      properties: {
        controlledContextDelivery: { type: "string", enum: ["observed", "supported_no_observation"] },
        explicitOutputReference: { type: "string", enum: ["observed", "supported_no_observation", "unavailable"] },
        internalUse: { const: "unsupported" },
      },
      required: ["controlledContextDelivery", "explicitOutputReference", "internalUse"],
      additionalProperties: false,
    },
    documents: { type: "array", items: documentCoverageSchema, maxItems: 1000 },
    coverage: {
      type: "object",
      properties: {
        delivery: nullableRatioSchema,
        explicitReference: nullableRatioSchema,
        relevance: nullableRatioSchema,
        candidateSelection: nullableRatioSchema,
      },
      required: ["delivery", "explicitReference", "relevance", "candidateSelection"],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "reportKind",
    "executionMode",
    "projectId",
    "runId",
    "sessionIds",
    "provider",
    "status",
    "capabilities",
    "documents",
    "coverage",
  ],
  additionalProperties: false,
} as const;

export type ManagedContextCoverageReport = FromSchema<
  typeof managedContextCoverageReportSchema
>;
export type ManagedContextDocumentCoverage = ManagedContextCoverageReport["documents"][number];
