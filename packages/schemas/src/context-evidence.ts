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
  timestampSchema,
} from "./common.js";
import {
  contextRecommendationProperties,
  contextRecommendationRequired,
} from "./context-recommendation.js";
import { knowledgeContextSchema } from "./knowledge-context.js";

export const contextEvidenceStates = [
  "discovered",
  "recommended",
  "selected",
  "loaded",
  "injected",
  "referenced",
] as const;

export const selectionReasonCodes = [
  "explicit_instruction",
  "path_rule",
  "role_required",
  "parent_instruction",
  "explicit_link",
  "handoff",
  "search_recommendation",
] as const;

const commonProperties = {
  receiptId: receiptIdSchema,
  projectId: projectIdSchema,
  runId: runIdSchema,
  sessionId: sessionIdSchema,
  documentId: documentIdSchema,
  recordedAt: timestampSchema,
  knowledgeContext: knowledgeContextSchema,
} as const;

const commonRequired = [
  "receiptId",
  "projectId",
  "runId",
  "sessionId",
  "documentId",
  "state",
  "recordedAt",
] as const;

export const contextEvidenceSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/context-evidence.schema.json",
  title: "Lervo context evidence receipt",
  oneOf: [
    {
      type: "object",
      properties: {
        ...commonProperties,
        state: { const: "discovered" },
        path: { type: "string", minLength: 1 },
      },
      required: [...commonRequired, "path"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...commonProperties,
        ...contextRecommendationProperties,
        state: { const: "recommended" },
      },
      required: [...commonRequired, ...contextRecommendationRequired],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...commonProperties,
        state: { const: "selected" },
        required: { type: "boolean" },
        scope: scopeSchema,
        policyVersion: sha256Schema,
        reasonCode: { type: "string", enum: selectionReasonCodes },
        ruleId: { type: "string", minLength: 1 },
      },
      required: [
        ...commonRequired,
        "required",
        "scope",
        "policyVersion",
        "reasonCode",
        "ruleId"
      ],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...commonProperties,
        state: { const: "loaded" },
        scope: scopeSchema,
        contentHash: sha256Schema,
        byteCount: { type: "integer", minimum: 0 },
        sourceRevision: { type: "string", minLength: 1 },
      },
      required: [
        ...commonRequired,
        "scope",
        "contentHash",
        "byteCount",
        "sourceRevision"
      ],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...commonProperties,
        state: { const: "injected" },
        scope: scopeSchema,
        contentHash: sha256Schema,
        provider: providerSchema,
        providerSessionId: { type: "string", minLength: 1 },
        adapterId: { type: "string", minLength: 1 },
        adapterReceiptId: receiptIdSchema,
        envelopeId: { type: "string", minLength: 1 },
        targetTurnId: { type: "string", minLength: 1 },
        contextGeneration: { type: "integer", minimum: 0 },
        controlledInput: { const: true },
      },
      required: [
        ...commonRequired,
        "scope",
        "contentHash",
        "provider",
        "providerSessionId",
        "adapterId",
        "adapterReceiptId",
        "envelopeId",
        "targetTurnId",
        "contextGeneration",
        "controlledInput"
      ],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...commonProperties,
        state: { const: "referenced" },
        contentHash: sha256Schema,
        scope: scopeSchema,
        provider: providerSchema,
        providerSessionId: { type: "string", minLength: 1 },
        targetTurnId: { type: "string", minLength: 1 },
        providerTurnId: { type: "string", minLength: 1 },
        contextGeneration: { type: "integer", minimum: 0 },
        adapterReceiptId: receiptIdSchema,
        injectedEvidenceReceiptId: receiptIdSchema,
        sourceEventId: eventIdSchema,
        referenceKind: {
          type: "string",
          enum: ["output_citation", "tool_decision", "verification"],
        },
        citation: { type: "string", minLength: 1, maxLength: 500 },
      },
      required: [
        ...commonRequired,
        "contentHash",
        "scope",
        "provider",
        "providerSessionId",
        "targetTurnId",
        "providerTurnId",
        "contextGeneration",
        "adapterReceiptId",
        "injectedEvidenceReceiptId",
        "sourceEventId",
        "referenceKind",
        "citation"
      ],
      additionalProperties: false,
    },
  ],
} as const;

export type ContextEvidence = FromSchema<typeof contextEvidenceSchema>;
export type ContextEvidenceState = (typeof contextEvidenceStates)[number];
export type SelectionReasonCode = (typeof selectionReasonCodes)[number];
