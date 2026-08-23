import type { FromSchema } from "json-schema-to-ts";

export const knowledgeContextSchema = {
  type: "object",
  properties: {
    conceptId: { type: "string", pattern: "^concept_[a-f0-9]{24}$" },
    assurance: { type: "string", enum: ["unreviewed", "machine_reviewed", "human_reviewed", "verified"] },
    freshness: { type: "string", enum: ["current", "stale", "unknown"] },
    sourceSnapshotId: { type: "string", pattern: "^ksnap_[a-f0-9]{24}$" },
    impactReportId: { type: "string", pattern: "^kimpact_[a-f0-9]{24}$" },
  },
  required: ["conceptId", "assurance", "freshness", "sourceSnapshotId", "impactReportId"],
  additionalProperties: false,
} as const;

export type KnowledgeContextMetadata = FromSchema<typeof knowledgeContextSchema>;
