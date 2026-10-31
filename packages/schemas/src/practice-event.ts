import { sha256Schema, timestampSchema } from "./common.js";

const text = { type: "string", minLength: 1, maxLength: 128 } as const;
const nullableHash = { anyOf: [sha256Schema, { type: "null" }] } as const;
const candidateId = { type: "string", pattern: "^kpc_[a-f0-9]{24}$" } as const;
const hashes = {
  type: "array",
  minItems: 1,
  maxItems: 16,
  uniqueItems: true,
  items: sha256Schema,
} as const;

export const learningObservationRecordedEventPayloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    observationId: candidateId,
    agentId: { anyOf: [text, { type: "null" }] },
    surface: { enum: ["terminal", "managed_run", "conversation", "supervision"] },
    kind: { const: "portable_skill" },
    sourceEventId: text,
    verificationStatus: { const: "passed" },
    occurredAt: timestampSchema,
  },
  required: [
    "observationId",
    "agentId",
    "surface",
    "kind",
    "sourceEventId",
    "verificationStatus",
    "occurredAt",
  ],
} as const;
export const knowledgeSkillCandidateProposedEventPayloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidateId,
    practiceDigest: sha256Schema,
    workDigests: hashes,
    overlap: { enum: ["new", "partial_overlap", "conflict"] },
    targetSkill: { anyOf: [text, { type: "null" }] },
    draftHash: sha256Schema,
    occurredAt: timestampSchema,
  },
  required: [
    "candidateId",
    "practiceDigest",
    "workDigests",
    "overlap",
    "targetSkill",
    "draftHash",
    "occurredAt",
  ],
} as const;
export const knowledgeSkillCandidateResolvedEventPayloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidateId,
    decision: { enum: ["accept", "reject", "unresolved", "expired", "keep", "retire"] },
    reasonCode: {
      enum: [
        "accepted",
        "not_reusable",
        "duplicate",
        "incomplete",
        "ungrounded",
        "conflict",
        "assessment_expired",
        "retained",
        "unused_with_coverage",
      ],
    },
    reviewerAgentId: { anyOf: [text, { type: "null" }] },
    reviewedDraftHash: nullableHash,
    catalogDigest: sha256Schema,
    occurredAt: timestampSchema,
  },
  required: [
    "candidateId",
    "decision",
    "reasonCode",
    "reviewerAgentId",
    "reviewedDraftHash",
    "catalogDigest",
    "occurredAt",
  ],
} as const;
export const knowledgeSkillUsageAssessedEventPayloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    skillName: text,
    versionHash: sha256Schema,
    usageState: { enum: ["used", "unused_with_coverage", "unknown"] },
    observedTurns: { type: "integer", minimum: 0 },
    coverage: { enum: ["complete", "unknown"] },
    occurredAt: timestampSchema,
  },
  required: ["skillName", "versionHash", "usageState", "observedTurns", "coverage", "occurredAt"],
} as const;
export const knowledgeSkillRetiredEventPayloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    skillName: text,
    versionHash: sha256Schema,
    retirementCommit: { type: "string", pattern: "^[a-f0-9]{40,64}$" },
    occurredAt: timestampSchema,
  },
  required: ["skillName", "versionHash", "retirementCommit", "occurredAt"],
} as const;
