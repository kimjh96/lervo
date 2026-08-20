import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  roleEvaluationBundleIdSchema,
  roleEvaluationResultIdSchema,
  roleIdSchema,
  runIdSchema,
  schemaReferenceSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
  verificationSuiteIdSchema,
} from "./common.js";

export const roleEvaluationCategories = [
  "artifact_schema",
  "source_traceability",
  "citation_integrity",
  "claim_support",
  "brand_compliance",
  "design_token_usage",
  "accessibility",
] as const;

export const roleEvaluationMethods = [
  "deterministic",
  "separate_semantic",
  "project_verification",
] as const;

const checkIdSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
  maxLength: 150,
} as const;

const roleEvaluationCheckSchema = {
  type: "object",
  properties: {
    checkId: checkIdSchema,
    category: { type: "string", enum: roleEvaluationCategories },
    method: { type: "string", enum: roleEvaluationMethods },
    requirement: { type: "string", minLength: 1, maxLength: 1_000 },
    verificationSuiteId: {
      oneOf: [verificationSuiteIdSchema, { type: "null" }],
    },
    evidenceRequired: { const: true },
  },
  required: [
    "checkId",
    "category",
    "method",
    "requirement",
    "verificationSuiteId",
    "evidenceRequired",
  ],
  additionalProperties: false,
} as const;

export const roleEvaluationBundleSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/role-evaluation-bundle.schema.json",
  title: "Lervo role evaluation bundle",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    bundleId: roleEvaluationBundleIdSchema,
    roleId: roleIdSchema,
    roleProfileHash: sha256Schema,
    outputSchemaRef: schemaReferenceSchema,
    checks: {
      type: "array",
      items: roleEvaluationCheckSchema,
      minItems: 1,
      maxItems: 32,
    },
    publicationRequiresPassedEvaluation: { const: true },
    highRiskDisposition: { const: "deliberation_required" },
  },
  required: [
    "schemaVersion",
    "bundleId",
    "roleId",
    "roleProfileHash",
    "outputSchemaRef",
    "checks",
    "publicationRequiresPassedEvaluation",
    "highRiskDisposition",
  ],
  additionalProperties: false,
} as const;

const roleEvaluationEvidenceSchema = {
  type: "object",
  properties: {
    artifactId: artifactIdSchema,
    contentHash: sha256Schema,
  },
  required: ["artifactId", "contentHash"],
  additionalProperties: false,
} as const;

const roleEvaluationCheckResultSchema = {
  type: "object",
  properties: {
    checkId: checkIdSchema,
    method: { type: "string", enum: roleEvaluationMethods },
    status: { type: "string", enum: ["passed", "failed", "not_run"] },
    evaluatorId: { type: "string", minLength: 1, maxLength: 150 },
    evaluatorRunId: { oneOf: [runIdSchema, { type: "null" }] },
    evaluatorRoleId: { oneOf: [roleIdSchema, { type: "null" }] },
    evidence: {
      type: "array",
      items: roleEvaluationEvidenceSchema,
      maxItems: 16,
    },
  },
  required: [
    "checkId",
    "method",
    "status",
    "evaluatorId",
    "evaluatorRunId",
    "evaluatorRoleId",
    "evidence",
  ],
  additionalProperties: false,
} as const;

export const roleEvaluationResultSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/role-evaluation-result.schema.json",
  title: "Lervo role evaluation result",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    resultId: roleEvaluationResultIdSchema,
    bundleId: roleEvaluationBundleIdSchema,
    bundleHash: sha256Schema,
    roleId: roleIdSchema,
    roleProfileHash: sha256Schema,
    producerRunId: runIdSchema,
    artifactId: artifactIdSchema,
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 1, maximum: 4_194_304 },
    mediaType: {
      type: "string",
      enum: [
        "text/markdown; charset=utf-8",
        "application/json; charset=utf-8",
      ],
    },
    evaluatedAt: timestampSchema,
    checks: {
      type: "array",
      items: roleEvaluationCheckResultSchema,
      minItems: 1,
      maxItems: 32,
    },
    overallStatus: { type: "string", enum: ["passed", "failed", "incomplete"] },
  },
  required: [
    "schemaVersion",
    "resultId",
    "bundleId",
    "bundleHash",
    "roleId",
    "roleProfileHash",
    "producerRunId",
    "artifactId",
    "contentHash",
    "byteCount",
    "mediaType",
    "evaluatedAt",
    "checks",
    "overallStatus",
  ],
  additionalProperties: false,
} as const;

export type RoleEvaluationBundle = FromSchema<typeof roleEvaluationBundleSchema>;
export type RoleEvaluationCheck = RoleEvaluationBundle["checks"][number];
export type RoleEvaluationResult = FromSchema<typeof roleEvaluationResultSchema>;
export type RoleEvaluationCheckResult = RoleEvaluationResult["checks"][number];
export type RoleEvaluationCategory = (typeof roleEvaluationCategories)[number];
export type RoleEvaluationMethod = (typeof roleEvaluationMethods)[number];
