import type { FromSchema } from "json-schema-to-ts";
import { projectIdSchema, sha256Schema, timestampSchema } from "./common.js";

const shared = {
  projectId: projectIdSchema,
  findingDigest: sha256Schema,
  documentHash: sha256Schema,
  evidenceContractHash: sha256Schema,
  receiptHash: sha256Schema,
  occurredAt: timestampSchema,
} as const;
const required = [
  "projectId",
  "findingDigest",
  "documentHash",
  "evidenceContractHash",
  "receiptHash",
  "outcome",
  "occurredAt",
] as const;

export const documentFreshnessEvidenceRecoveredEventPayloadSchema = {
  type: "object",
  properties: {
    ...shared,
    outcome: { type: "string", enum: ["ready", "incomplete", "unavailable", "exhausted"] },
    predecessorCandidateId: {
      anyOf: [{ type: "string", pattern: "^kfresh_[a-f0-9]{24}$" }, { type: "null" }],
    },
    attempt: { type: "integer", minimum: 1, maximum: 16 },
  },
  required: [...required, "predecessorCandidateId", "attempt"],
  additionalProperties: false,
} as const;

export const documentFreshnessAssessmentRecordedEventPayloadSchema = {
  type: "object",
  properties: {
    ...shared,
    outcome: { type: "string", enum: ["verified_no_change", "changed", "unavailable"] },
    dependencyDigest: sha256Schema,
    verificationContractHash: sha256Schema,
  },
  required: [...required, "dependencyDigest", "verificationContractHash"],
  additionalProperties: false,
} as const;

export type DocumentFreshnessEvidenceRecoveredEventPayload = FromSchema<
  typeof documentFreshnessEvidenceRecoveredEventPayloadSchema
>;
export type DocumentFreshnessAssessmentRecordedEventPayload = FromSchema<
  typeof documentFreshnessAssessmentRecordedEventPayloadSchema
>;
export const knowledgeMaintenanceEventTypes = [
  "document.freshness.evidence.recovered",
  "document.freshness.assessment.recorded",
] as const;
