import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema } from "./common.js";
import { contextQualityIdentifierSchema as id } from "./context-quality-request.js";

export const contextQualityReasonCodes = [
  "context_binding_unavailable",
  "context_contract_invalid",
  "context_rule_unresolved",
  "context_rule_conflict",
  "context_corpus_incomplete",
  "context_retrieval_unavailable",
  "context_required_section_missing",
  "context_capacity_insufficient",
  "context_binding_stale",
  "context_budget_exceeded",
  "context_cancelled",
  "context_token_count_unavailable",
] as const;
const count = { type: "integer", minimum: 0, maximum: 2147483647 } as const;
const nullableCount = { anyOf: [count, { type: "null" }] } as const;
const ids = { type: "array", maxItems: 64, uniqueItems: true, items: id } as const;
const reasonCodes = {
  type: "array",
  maxItems: 32,
  uniqueItems: true,
  items: { enum: contextQualityReasonCodes },
} as const;
const range = { byteStart: count, byteEnd: count } as const;

export const contextQualityObligationSchema = {
  type: "object",
  properties: {
    ruleId: id,
    sourceId: id,
    sourceHash: sha256Schema,
    ...range,
    locator: { type: "string", minLength: 1, maxLength: 256 },
    authorityClass: { enum: ["configured", "reviewed_scope", "provider_instruction"] },
    scopeDigest: sha256Schema,
    disposition: { enum: ["applicable", "not_applicable", "unresolved", "conflict"] },
    conditionRefs: ids,
    exceptionRefs: ids,
    verificationDefinition: id,
  },
  required: [
    "ruleId",
    "sourceId",
    "sourceHash",
    "byteStart",
    "byteEnd",
    "locator",
    "authorityClass",
    "scopeDigest",
    "disposition",
    "conditionRefs",
    "exceptionRefs",
    "verificationDefinition",
  ],
  additionalProperties: false,
} as const;

export const contextQualitySectionSchema = {
  type: "object",
  properties: {
    sourceId: id,
    sourceHash: sha256Schema,
    ...range,
    sectionHash: sha256Schema,
    locator: { type: "string", minLength: 1, maxLength: 256 },
    role: { enum: ["obligation", "evidence"] },
    required: { type: "boolean" },
    ruleIds: ids,
  },
  required: [
    "sourceId",
    "sourceHash",
    "byteStart",
    "byteEnd",
    "sectionHash",
    "locator",
    "role",
    "required",
    "ruleIds",
  ],
  additionalProperties: false,
} as const;

export const contextQualityEvidenceSchema = {
  type: "object",
  properties: {
    applicability: { enum: ["complete", "unobserved"] },
    obligations: { type: "array", maxItems: 64, items: contextQualityObligationSchema },
    corpusCoverage: {
      type: "object",
      properties: {
        sourceSnapshotId: id,
        scopeDigest: sha256Schema,
        disposition: { enum: ["complete", "incomplete", "unobserved"] },
        discovered: nullableCount,
        eligible: nullableCount,
        indexed: nullableCount,
        excluded: nullableCount,
        unavailable: nullableCount,
      },
      required: [
        "sourceSnapshotId",
        "scopeDigest",
        "disposition",
        "discovered",
        "eligible",
        "indexed",
        "excluded",
        "unavailable",
      ],
      additionalProperties: false,
    },
    retrieval: {
      type: "object",
      properties: {
        disposition: { enum: ["completed", "not_run", "unavailable"] },
        resultDigest: { anyOf: [sha256Schema, { type: "null" }] },
      },
      required: ["disposition", "resultDigest"],
      additionalProperties: false,
    },
    sections: { type: "array", maxItems: 64, items: contextQualitySectionSchema },
    selectedEvidenceCount: { type: "integer", minimum: 0, maximum: 50 },
    tokenCount: nullableCount,
    retrievalReceiptRefs: { type: "array", maxItems: 16, uniqueItems: true, items: id },
  },
  required: [
    "applicability",
    "obligations",
    "corpusCoverage",
    "retrieval",
    "sections",
    "selectedEvidenceCount",
    "tokenCount",
    "retrievalReceiptRefs",
  ],
  additionalProperties: false,
} as const;

export const contextQualityPlanSchema = {
  $id: "https://schemas.lervo.dev/v1/context-quality-plan.schema.json",
  type: "object",
  properties: {
    schemaVersion: { const: 1 },
    requestId: id,
    semanticInputDigest: sha256Schema,
    planDigest: sha256Schema,
    status: { enum: ["ready", "no_evidence", "incomplete", "unavailable", "stale", "cancelled"] },
    reasonCodes,
    ...contextQualityEvidenceSchema.properties,
    coverage: {
      type: "object",
      properties: {
        required: { type: "integer", minimum: 0, maximum: 64 },
        resolved: { type: "integer", minimum: 0, maximum: 64 },
        loaded: { type: "integer", minimum: 0, maximum: 64 },
        missingRuleIds: ids,
        packedEvidenceCount: { type: "integer", minimum: 0, maximum: 50 },
        omittedOptionalEvidenceCount: { type: "integer", minimum: 0, maximum: 50 },
        preparedByteCount: count,
      },
      required: [
        "required",
        "resolved",
        "loaded",
        "missingRuleIds",
        "packedEvidenceCount",
        "omittedOptionalEvidenceCount",
        "preparedByteCount",
      ],
      additionalProperties: false,
    },
    costObservation: {
      type: "object",
      properties: {
        elapsedMs: { anyOf: [{ type: "number", minimum: 0, maximum: 600000 }, { type: "null" }] },
        reason: { enum: ["observed", "unobserved"] },
      },
      required: ["elapsedMs", "reason"],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "requestId",
    "semanticInputDigest",
    "planDigest",
    "status",
    "reasonCodes",
    ...contextQualityEvidenceSchema.required,
    "coverage",
    "costObservation",
  ],
  additionalProperties: false,
} as const;

export type ContextQualityEvidence = FromSchema<typeof contextQualityEvidenceSchema>;
export type ContextQualityPlan = FromSchema<typeof contextQualityPlanSchema>;
export type ContextQualityReasonCode = (typeof contextQualityReasonCodes)[number];
