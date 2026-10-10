import type { FromSchema } from "json-schema-to-ts";
import { sha256Schema } from "./common.js";
import { contextQualityIdentifierSchema as id } from "./context-quality-request.js";
import { contextQualityPlanSchema } from "./context-quality-plan.js";
import { contextQualityVerificationSchema } from "./context-quality-verification.js";
const count = { type: "integer", minimum: 0, maximum: 2147483647 } as const;
const nullableDigest = { anyOf: [sha256Schema, { type: "null" }] } as const;
const nullableId = { anyOf: [id, { type: "null" }] } as const;
const preparedProperties = {
  schemaVersion: { const: 1 },
  requestId: id,
  taskRevision: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
  semanticInputDigest: nullableDigest,
  planDigest: nullableDigest,
  sourceSnapshotId: nullableId,
  scopeDigest: nullableDigest,
  policySetDigest: nullableDigest,
  profileId: nullableId,
  executionMode: { enum: ["managed", "unmanaged"] },
  originKind: { enum: ["terminal", "managed_run", "conversation", "native_chat"] },
  adapterBuildId: sha256Schema,
  status: contextQualityPlanSchema.properties.status,
  reasonCodes: contextQualityPlanSchema.properties.reasonCodes,
  requiredCount: { anyOf: [count, { type: "null" }] },
  resolvedCount: { anyOf: [count, { type: "null" }] },
  loadedCount: { anyOf: [count, { type: "null" }] },
  evidenceCount: { anyOf: [count, { type: "null" }] },
  sectionCount: { anyOf: [count, { type: "null" }] },
  coverageDisposition: { enum: ["complete", "incomplete", "unobserved", "unavailable"] },
  reportArtifactHash: sha256Schema,
  stageObservationHashes: { type: "array", maxItems: 32, uniqueItems: true, items: sha256Schema },
} as const;
export const contextQualityPreparedEventPayloadSchema = {
  type: "object",
  properties: preparedProperties,
  required: Object.keys(preparedProperties) as (keyof typeof preparedProperties)[],
  additionalProperties: false,
} as const;
const verifiedProperties = {
  schemaVersion: { const: 1 },
  requestId: id,
  planDigest: sha256Schema,
  artifactDigest: sha256Schema,
  verificationDefinitionId: id,
  verificationDefinitionHash: sha256Schema,
  evaluatorBuildId: sha256Schema,
  disposition: contextQualityVerificationSchema.anyOf[0].properties.disposition,
  reasonCodes: contextQualityVerificationSchema.anyOf[0].properties.reasonCodes,
  verificationArtifactHash: sha256Schema,
} as const;
export const contextQualityVerifiedEventPayloadSchema = {
  type: "object",
  properties: verifiedProperties,
  required: Object.keys(verifiedProperties) as (keyof typeof verifiedProperties)[],
  additionalProperties: false,
} as const;
export type ContextQualityPreparedEventPayload = FromSchema<
  typeof contextQualityPreparedEventPayloadSchema
>;
export type ContextQualityVerifiedEventPayload = FromSchema<
  typeof contextQualityVerifiedEventPayloadSchema
>;
