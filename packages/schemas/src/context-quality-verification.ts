import type { FromSchema } from "json-schema-to-ts";
import { sha256Schema, timestampSchema } from "./common.js";
import { contextQualityIdentifierSchema as id } from "./context-quality-request.js";

const legacyContextQualityVerificationSchema = {
  type: "object",
  properties: {
    schemaVersion: { const: 1 },
    planDigest: sha256Schema,
    artifactDigest: sha256Schema,
    baselineDigest: { anyOf: [sha256Schema, { type: "null" }] },
    verificationDefinitionId: id,
    verificationDefinitionHash: sha256Schema,
    evaluatorBuildId: sha256Schema,
    scope: { const: "publication_writing_and_protected_material" },
    disposition: { enum: ["passed", "failed", "unavailable", "not_applicable"] },
    reasonCodes: {
      type: "array",
      maxItems: 8,
      uniqueItems: true,
      items: {
        enum: [
          "context_verification_failed",
          "context_verification_unavailable",
          "context_binding_stale",
          "context_protected_material_changed",
          "context_not_publication",
          "context_language_exception",
        ],
      },
    },
    writingEvaluationDigest: { anyOf: [sha256Schema, { type: "null" }] },
    protectedMaterial: { enum: ["passed", "failed", "not_requested", "unavailable"] },
    observedAt: timestampSchema,
    observationDigest: sha256Schema,
  },
  required: [
    "schemaVersion",
    "planDigest",
    "artifactDigest",
    "baselineDigest",
    "verificationDefinitionId",
    "verificationDefinitionHash",
    "evaluatorBuildId",
    "scope",
    "disposition",
    "reasonCodes",
    "writingEvaluationDigest",
    "protectedMaterial",
    "observedAt",
    "observationDigest",
  ],
  additionalProperties: false,
} as const;
const taskVerificationSchema = {
  type: "object",
  properties: {
    definitionHash: sha256Schema,
    evaluatorBuildId: { anyOf: [sha256Schema, { type: "null" }] },
    disposition: { enum: ["passed", "failed", "unavailable"] },
    checks: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: {
        type: "object",
        properties: { checkId: id, status: { enum: ["passed", "failed", "unavailable"] } },
        required: ["checkId", "status"],
        additionalProperties: false,
      },
    },
    evaluationDigest: sha256Schema,
  },
  required: ["definitionHash", "evaluatorBuildId", "disposition", "checks", "evaluationDigest"],
  additionalProperties: false,
} as const;
const completeContextQualityVerificationSchema = {
  ...legacyContextQualityVerificationSchema,
  properties: {
    ...legacyContextQualityVerificationSchema.properties,
    schemaVersion: { const: 2 },
    scope: { enum: ["publication_writing_and_protected_material", "task_and_artifact"] },
    writingRequired: { type: "boolean" },
    taskVerification: { anyOf: [taskVerificationSchema, { type: "null" }] },
    languageExceptionDigest: { anyOf: [sha256Schema, { type: "null" }] },
  },
  required: [
    ...legacyContextQualityVerificationSchema.required,
    "writingRequired",
    "taskVerification",
    "languageExceptionDigest",
  ],
} as const;
export const contextQualityVerificationSchema = {
  anyOf: [legacyContextQualityVerificationSchema, completeContextQualityVerificationSchema],
} as const;
export type ContextQualityVerification = FromSchema<typeof contextQualityVerificationSchema>;
